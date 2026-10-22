import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import { buildBatch, buildMessages, topicFor, type PublisherOptions } from '@iot/simulators';
import type Redis from 'ioredis';
import mqtt from 'mqtt';
import type pg from 'pg';
import request from 'supertest';
import { applyMigrations } from '../src/ingestion/infra/sql-migrations';
import { createTenant, startTestApp, type TestApp } from './support/app';
import { MIGRATIONS_DIR, type Infra } from './support/infra';

const TENANT = 'inquilino-teste';
let SENSOR_A: string;
let TOKEN_A: string;

const base: PublisherOptions = {
  tenant: TENANT,
  site: 'site-teste',
  domain: 'dominio-teste',
  device: 'sensor-a',
  quantity: 'temperatura',
  unit: 'Cel',
  initialValue: 20,
  step: 0.01,
  count: 1,
  intervalMs: 1000,
  start: new Date('2026-10-25T00:00:00Z'),
};

// Cada chamada gera horários novos, para as medições de testes diferentes não colidirem.
let offsetHours = 0;
function messages(overrides: Partial<PublisherOptions> = {}) {
  offsetHours += 1;
  return buildMessages({
    ...base,
    start: new Date(base.start.getTime() + offsetHours * 3_600_000),
    ...overrides,
  });
}

async function eventually<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida no prazo');
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Pipeline da T1a contra o catálogo real (PrismaDeviceDirectory), criado pela API.
describe('ingestão de ponta a ponta (Testcontainers)', () => {
  let t: TestApp;
  let infra: Infra;
  let app: NestExpressApplication;
  let db: pg.Pool;
  let redis: Redis;
  let publisher: mqtt.MqttClient;
  let responses: ResponseValidator;
  let profileId: string;
  let siteId: string;

  const catalog = async (path: string, body: object) =>
    (
      await request(app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('X-Tenant', TENANT)
        .send(body)
        .expect(201)
    ).body;

  const countMeasurements = async (ids: string[]) =>
    Number(
      (
        await db.query<{ n: string }>(
          'SELECT count(*) AS n FROM measurements WHERE message_id = ANY($1::uuid[])',
          [ids],
        )
      ).rows[0]!.n,
    );

  beforeAll(async () => {
    responses = await createResponseValidator();
    t = await startTestApp();
    ({ infra, app, db, redis } = t);
    await createTenant(db, TENANT);
    const dominio = await catalog('/catalogo/dominios', { slug: 'dominio-teste', nome: 'Teste' });
    const perfil = await catalog('/perfis', {
      dominio_id: dominio.id,
      nome: 'termômetro',
      intervalo_esperado_s: 60,
      grandezas: [{ nome: 'temperatura', unidade: 'Cel', faixa: { min: -20, max: 60 } }],
    });
    const site = await catalog('/sites', { slug: 'site-teste', nome: 'Site de teste' });
    profileId = perfil.id;
    siteId = site.id;
    const sensorA = await catalog('/dispositivos', {
      slug: 'sensor-a',
      perfil_id: perfil.id,
      site_id: site.id,
    });
    await catalog('/dispositivos', { slug: 'sensor-b', perfil_id: perfil.id, site_id: site.id });
    SENSOR_A = sensorA.id;
    TOKEN_A = sensorA.credencial;

    publisher = await mqtt.connectAsync(`mqtt://${infra.env.MQTT_HOST}:${infra.env.MQTT_PORT}`, {
      username: infra.env.MQTT_INGEST_USERNAME,
      password: infra.env.MQTT_INGEST_PASSWORD,
    });
  }, 180_000);

  afterAll(async () => {
    await publisher?.endAsync();
    await t?.close();
  }, 60_000);

  it('aplicar as migrações de novo não faz nada', async () => {
    await expect(applyMigrations(db, MIGRATIONS_DIR)).resolves.toEqual([]);
    const { rows } = await db.query(
      "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'measurements'",
    );
    expect(rows).toHaveLength(1);
  });

  it('10. publicar no tópico MQTT grava a medição na hipertabela e publica o evento', async () => {
    const [message] = messages();
    await publisher.publishAsync(topicFor(base), JSON.stringify(message), { qos: 1 });

    const row = await eventually(async () => {
      const { rows } = await db.query(
        'SELECT quantity, value, unit, suspect, late, ts FROM measurements WHERE message_id = $1',
        [message!.id_mensagem],
      );
      return rows[0];
    });
    expect(row).toMatchObject({ quantity: 'temperatura', value: 20, unit: 'Cel', suspect: false });
    expect((row.ts as Date).toISOString()).toBe(new Date(message!.timestamp).toISOString());

    const event = await eventually(async () => {
      const entries = await redis.xrange('measurement.ingested', '-', '+');
      const found = entries
        .map(([, fields]) => JSON.parse(fields[1]!) as { messageId: string })
        .find((e) => e.messageId === message!.id_mensagem);
      return found;
    });
    expect(event).toMatchObject({ type: 'measurement.ingested', deviceSlug: 'sensor-a' });
  });

  it('11. POST /api/v1/ingestao devolve 202 para a válida e 400 com erros para a inválida', async () => {
    const [valid] = messages();
    const [invalid] = messages({ invalidAt: [0] });
    const server = app.getHttpServer();

    await request(server)
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send(valid)
      .expect(202)
      .expect({ indice: 0, id_mensagem: valid!.id_mensagem, resultado: 'aceita' });

    const refused = await request(server)
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send(invalid)
      .expect(400);
    expect(refused.body).toMatchObject({ codigo: 'mensagem_recusada' });
    expect(refused.body.detalhes).toContainEqual(
      expect.objectContaining({ caminho: '/versao', regra: 'required' }),
    );

    await request(server).post('/api/v1/ingestao').send(valid).expect(401);
    expect(await countMeasurements([valid!.id_mensagem])).toBe(1);
  });

  describe('lote de 5.000 mensagens com 3 inválidas', () => {
    const invalidAt = [10, 2500, 4999];
    let batch: ReturnType<typeof buildBatch>;

    beforeAll(() => {
      const all = messages({ count: 5000, invalidAt: [10] });
      // Três defeitos diferentes: sem versao, unidade vazia e campo fora do contrato.
      all[2500]!.medidas[0]!.unidade = '';
      (all[4999] as unknown as Record<string, unknown>).extra = 1;
      batch = buildBatch(all, 'sensor-a');
    });

    it('12. grava 4.997 e informa as 3 recusadas, com o motivo de cada uma', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/ingestao/lote')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send(batch)
        .expect(200);

      const results = response.body.resultados as {
        id_mensagem: string;
        resultado: string;
        erros?: { caminho: string; regra: string; mensagem: string }[];
      }[];
      expect(response.body.id_lote).toBe(batch.id_lote);
      expect(responses.validate('ResultadoLote', response.body).errors).toEqual([]);
      expect(
        (response.body.resultados as { indice: number }[]).every((r, index) => r.indice === index),
      ).toBe(true);
      expect(results).toHaveLength(5000);
      expect(results.filter((r) => r.resultado === 'aceita')).toHaveLength(4997);
      const refused = results
        .map((r, index) => ({ ...r, index }))
        .filter((r) => r.resultado === 'recusada');
      expect(refused.map((r) => r.index)).toEqual(invalidAt);
      expect(refused[0]!.erros).toContainEqual(expect.objectContaining({ caminho: '/versao' }));
      expect(refused[1]!.erros).toContainEqual(
        expect.objectContaining({ caminho: '/medidas/0/unidade', regra: 'minLength' }),
      );
      expect(refused[2]!.erros).toContainEqual(
        expect.objectContaining({ caminho: '/extra', regra: 'additionalProperties' }),
      );

      const ids = batch.mensagens.map((m) => m.id_mensagem);
      expect(await countMeasurements(ids)).toBe(4997);
      const dlq = await db.query(
        'SELECT message_id FROM dead_letters WHERE message_id = ANY($1::text[])',
        [ids],
      );
      expect(dlq.rows.map((r) => r.message_id).sort()).toEqual(invalidAt.map((i) => ids[i]).sort());
    }, 60_000);

    it('13. reenviar o mesmo lote não duplica nenhuma medição', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/ingestao/lote')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send(batch)
        .expect(200);
      const results = response.body.resultados as { resultado: string }[];
      expect(results.filter((r) => r.resultado === 'duplicada')).toHaveLength(4997);
      expect(results.filter((r) => r.resultado === 'recusada')).toHaveLength(3);
      expect(await countMeasurements(batch.mensagens.map((m) => m.id_mensagem))).toBe(4997);
    }, 60_000);
  });

  it('resposta HTTP de mensagem e de lote segue o OpenAPI, com indice e id nulo (ADR-012)', async () => {
    const [valid] = messages();
    const single = await request(app.getHttpServer())
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send(valid)
      .expect(202);
    expect(responses.validate('ResultadoMensagem', single.body).errors).toEqual([]);

    const [ok, noId] = messages({ count: 2 });
    delete (noId as unknown as Record<string, unknown>).id_mensagem;
    const batchResponse = await request(app.getHttpServer())
      .post('/api/v1/ingestao/lote')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send(buildBatch([ok!, noId!], 'sensor-a'))
      .expect(200);
    expect(responses.validate('ResultadoLote', batchResponse.body).errors).toEqual([]);
    expect(batchResponse.body.resultados[1]).toMatchObject({
      indice: 1,
      id_mensagem: null,
      resultado: 'recusada',
    });
  });

  it('14. tópico de um dispositivo com corpo de outro é recusado', async () => {
    const [message] = messages({ device: 'sensor-b' });
    await publisher.publishAsync(topicFor(base), JSON.stringify(message), { qos: 1 });

    const letter = await eventually(async () => {
      const { rows } = await db.query(
        'SELECT source, topic, issues FROM dead_letters WHERE message_id = $1',
        [message!.id_mensagem],
      );
      return rows[0];
    });
    expect(letter).toMatchObject({
      source: 'mqtt',
      topic: 'inquilino-teste/site-teste/dominio-teste/sensor-a/telemetria',
    });
    expect(letter.issues).toContainEqual(
      expect.objectContaining({ path: '/dispositivo', rule: 'topico' }),
    );
    expect(await countMeasurements([message!.id_mensagem])).toBe(0);
  });

  it('payload MQTT que não é JSON vai para a DLQ com o tópico e o texto truncado em 2 KB', async () => {
    const marker = randomUUID();
    const raw = `${marker} ${'z'.repeat(5000)}`;
    await publisher.publishAsync(topicFor(base), raw, { qos: 1 });

    const letter = await eventually(async () => {
      const { rows } = await db.query(
        "SELECT topic, payload, issues FROM dead_letters WHERE payload #>> '{}' LIKE $1",
        [`${marker}%`],
      );
      return rows[0];
    });
    expect(letter.topic).toBe('inquilino-teste/site-teste/dominio-teste/sensor-a/telemetria');
    expect(Buffer.byteLength(letter.payload as string)).toBe(2048);
    expect(letter.issues).toEqual([expect.objectContaining({ path: '', rule: 'type' })]);
  });

  it('15. lote com 5.001 mensagens é recusado inteiro, com 400 e o erro de contrato', async () => {
    const batch = buildBatch(messages({ count: 5001 }), 'sensor-a');
    const response = await request(app.getHttpServer())
      .post('/api/v1/ingestao/lote')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send(batch)
      .expect(400);

    expect(response.body).toMatchObject({ codigo: 'lote_invalido' });
    expect(response.body.detalhes).toEqual([
      expect.objectContaining({ caminho: '/mensagens', regra: 'maxItems' }),
    ]);
    const ids = batch.mensagens.map((m) => m.id_mensagem);
    expect(await countMeasurements(ids)).toBe(0);
    const dlq = await db.query(
      'SELECT count(*) AS n FROM dead_letters WHERE message_id = ANY($1::text[])',
      [ids],
    );
    expect(Number(dlq.rows[0].n)).toBe(0);
  }, 60_000);

  it('16. mensagem com campo fora do contrato é recusada, e o motivo aponta o campo', async () => {
    const [message] = messages();
    const response = await request(app.getHttpServer())
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .send({ ...message, nivel: 12 })
      .expect(400);

    expect(response.body.detalhes).toEqual([
      {
        caminho: '/nivel',
        regra: 'additionalProperties',
        mensagem: 'campo fora do contrato: nivel',
      },
    ]);
    const { rows } = await db.query('SELECT issues FROM dead_letters WHERE message_id = $1', [
      message!.id_mensagem,
    ]);
    expect(rows).toHaveLength(1);
  });

  describe('6. credencial revogada ou expirada', () => {
    it('revogar recusa o token no HTTP e no lote, mesmo depois de um uso aceito', async () => {
      const device = await catalog('/dispositivos', {
        slug: 'sensor-revogado',
        perfil_id: profileId,
        site_id: siteId,
      });
      const send = () => messages({ device: 'sensor-revogado' })[0]!;
      await request(app.getHttpServer())
        .post('/api/v1/ingestao')
        .set('Authorization', `Bearer ${device.credencial}`)
        .send(send())
        .expect(202);

      await request(app.getHttpServer())
        .post(`/api/v1/dispositivos/${device.id}/credenciais/revogar`)
        .set('X-Tenant', TENANT)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/ingestao')
        .set('Authorization', `Bearer ${device.credencial}`)
        .send(send())
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/ingestao/lote')
        .set('Authorization', `Bearer ${device.credencial}`)
        .send(buildBatch([send()], 'sensor-revogado'))
        .expect(401);
    });

    it('credencial expirada é recusada no HTTP e no lote', async () => {
      const device = await catalog('/dispositivos', {
        slug: 'sensor-expirado',
        perfil_id: profileId,
        site_id: siteId,
        credencial_expira_em: '2020-01-01T00:00:00Z',
      });
      const [message] = messages({ device: 'sensor-expirado' });
      await request(app.getHttpServer())
        .post('/api/v1/ingestao')
        .set('Authorization', `Bearer ${device.credencial}`)
        .send(message)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/ingestao/lote')
        .set('Authorization', `Bearer ${device.credencial}`)
        .send(buildBatch([message!], 'sensor-expirado'))
        .expect(401);
    });

    it('token com segredo trocado é recusado', async () => {
      const [id] = TOKEN_A.split('.');
      await request(app.getHttpServer())
        .post('/api/v1/ingestao')
        .set('Authorization', `Bearer ${id}.${'A'.repeat(43)}`)
        .send(messages()[0])
        .expect(401);
    });
  });

  it('GET /api/v1/dispositivos/{id}/telemetria devolve as medições pelo horário da medição', async () => {
    const sent = messages({ count: 3 });
    // Chegam invertidas.
    for (const message of [...sent].reverse()) {
      await request(app.getHttpServer())
        .post('/api/v1/ingestao')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send(message)
        .expect(202);
    }
    const response = await request(app.getHttpServer())
      .get(`/api/v1/dispositivos/${SENSOR_A}/telemetria`)
      .set('X-Tenant', TENANT)
      .query({ grandeza: 'temperatura', de: sent[0]!.timestamp, ate: sent[2]!.timestamp })
      .expect(200);

    expect(response.body.itens.map((i: { id_mensagem: string }) => i.id_mensagem)).toEqual(
      sent.map((m) => m.id_mensagem),
    );
    expect(response.body.itens[0]).toMatchObject({
      grandeza: 'temperatura',
      valor: 20,
      unidade: 'Cel',
      timestamp: sent[0]!.timestamp,
      suspeita: false,
    });
    expect(response.body.total).toBe(3);
  });

  it('GET da série: dispositivo fora do inquilino responde 404; existente sem medição, lista vazia', async () => {
    const get = (id: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/dispositivos/${id}/telemetria`)
        .set('X-Tenant', TENANT);
    await get(randomUUID()).expect(404);
    await get('abc').expect(404);
    const empty = await catalog('/dispositivos', {
      slug: 'sensor-vazio',
      perfil_id: profileId,
      site_id: siteId,
    });
    expect((await get(empty.id).expect(200)).body).toMatchObject({ itens: [], total: 0 });
  });
});
