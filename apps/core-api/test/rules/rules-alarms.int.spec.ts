import { randomUUID } from 'node:crypto';
import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';

const TENANT = 'inquilino-regras';

const levelRule = (overrides: Record<string, unknown> = {}) => ({
  nome: 'nível alto',
  escopo: 'central',
  ativa: true,
  condicao: { grandeza: 'nivel', operador: '>=', limite: 100, duracao: { leituras: 3 } },
  acoes: [{ tipo: 'gerar_alarme', severidade: 'alta' }],
  ...overrides,
});

interface Device {
  id: string;
  slug: string;
  credencial: string;
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

const settle = () => new Promise((r) => setTimeout(r, 1500));

describe('regras e alarmes (T1d)', () => {
  let t: TestApp;
  let contract: ResponseValidator;

  const api = () => request(t.app.getHttpServer());
  const as = (tenant: string) => ({
    get: (path: string) => api().get(`/api/v1${path}`).set('X-Tenant', tenant),
    post: (path: string, body: object) =>
      api().post(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
    patch: (path: string, body: object) =>
      api().patch(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
  });
  const a = () => as(TENANT);

  const devices: Record<string, Device> = {};
  let profileId: string;
  let siteId: string;

  // Mensagem canônica com o nível no horário dado (segundos antes de agora).
  const send = (device: Device, secondsAgo: number, nivel: number, id = randomUUID()) =>
    api()
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${device.credencial}`)
      .send({
        versao: '1.0',
        id_mensagem: id,
        dispositivo: device.slug,
        tipo: 'telemetria',
        timestamp: new Date(base - secondsAgo * 1000).toISOString(),
        medidas: [{ grandeza: 'nivel', valor: nivel, unidade: 'cm' }],
      })
      .expect(202);
  let base = Date.now();

  // Só os alarmes da regra sob teste (as regras da API também valem para estes dispositivos).
  let ruleUnderTest = '';
  const alarmRows = async (device: Device) =>
    (
      await t.db.query(
        `SELECT id, state, severity, occurred_at, rule_id FROM alarms
          WHERE device_id = $1 AND rule_id = $2 ORDER BY opened_at`,
        [device.id, ruleUnderTest],
      )
    ).rows;
  const streamEvents = async (stream: string, device: Device) =>
    (await t.redis.xrange(stream, '-', '+'))
      .map(([, fields]) => JSON.parse(fields[1]!) as Record<string, unknown>)
      .filter((e) => e.deviceId === device.id && e.ruleId === ruleUnderTest);

  async function createDevice(slug: string): Promise<Device> {
    return (
      await a()
        .post('/dispositivos', {
          slug,
          perfil_id: profileId,
          site_id: siteId,
          localizacao: { type: 'Point', coordinates: [-48.5, -16.5] },
        })
        .expect(201)
    ).body;
  }

  beforeAll(async () => {
    contract = await createResponseValidator();
    t = await startTestApp();
    await createTenant(t.db, TENANT);
    const dominio = (
      await a().post('/catalogo/dominios', { slug: 'medicao', nome: 'Medição' }).expect(201)
    ).body;
    profileId = (
      await a()
        .post('/perfis', {
          dominio_id: dominio.id,
          nome: 'nível',
          intervalo_esperado_s: 60,
          grandezas: [{ nome: 'nivel', unidade: 'cm' }],
        })
        .expect(201)
    ).body.id;
    siteId = (await a().post('/sites', { slug: 'centro', nome: 'Centro' }).expect(201)).body.id;
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  describe('API de regras (RF-PRO-02)', () => {
    it('cria na versão 1, valida pelo contrato e lê de volta', async () => {
      const created = await a().post('/regras', levelRule()).expect(201);
      expect(contract.validate('Regra', created.body).errors).toEqual([]);
      expect(created.body).toMatchObject({ versao: 1, ...levelRule() });

      const read = await a().get(`/regras/${created.body.id}`).expect(200);
      expect(read.body).toEqual(created.body);
    });

    it('regra fora do schema é recusada com o campo', async () => {
      const response = await a()
        .post('/regras', { ...levelRule(), acoes: undefined })
        .expect(400);
      expect(contract.validate('Erro', response.body).errors).toEqual([]);
      expect(response.body.detalhes).toContainEqual(expect.objectContaining({ regra: 'required' }));
    });

    it('cada alteração sobe a versão; a regra resultante passa pelo schema', async () => {
      const { body: rule } = await a()
        .post('/regras', levelRule({ nome: 'para alterar' }))
        .expect(201);
      const first = await a().patch(`/regras/${rule.id}`, { ativa: false }).expect(200);
      expect(first.body).toMatchObject({ versao: 2, ativa: false, nome: 'para alterar' });
      const second = await a()
        .patch(`/regras/${rule.id}`, { acoes: [{ tipo: 'gerar_alarme', severidade: 'critica' }] })
        .expect(200);
      expect(second.body.versao).toBe(3);
      expect(contract.validate('Regra', second.body).errors).toEqual([]);

      // Ausência com gerar_alarme é proibida pelo schema da regra inteira.
      await a()
        .patch(`/regras/${rule.id}`, { condicao: { ausencia: { intervalos: 3 } } })
        .expect(400);
      await a().patch(`/regras/${rule.id}`, {}).expect(400);
      expect((await a().get(`/regras/${rule.id}`).expect(200)).body.versao).toBe(3);
    });

    it('lista com filtros de escopo e ativa', async () => {
      await a()
        .post('/regras', levelRule({ nome: 'na borda', escopo: 'borda' }))
        .expect(201);
      const edge = await a().get('/regras?escopo=borda').expect(200);
      expect(contract.validate('PaginaRegras', edge.body).errors).toEqual([]);
      expect(edge.body.itens.map((r: { nome: string }) => r.nome)).toEqual(['na borda']);
      const inactive = await a().get('/regras?ativa=false').expect(200);
      expect(inactive.body.itens.map((r: { nome: string }) => r.nome)).toEqual(['para alterar']);
      await a().get('/regras?escopo=lua').expect(400);
    });

    it('id desconhecido ou fora do formato responde 404', async () => {
      await a().get('/regras/00000000-0000-4000-8000-000000000000').expect(404);
      await a().get('/regras/abc').expect(404);
    });
  });

  describe('motor de regras sobre measurement.ingested (RF-PRO-02, RF-PRO-05)', () => {
    let ruleId: string;

    beforeAll(async () => {
      for (const slug of ['motor-01', 'motor-02', 'motor-03'])
        devices[slug] = await createDevice(slug);
      ruleId = (
        await a()
          .post(
            '/regras',
            levelRule({
              nome: 'motor: nível alto',
              condicao: {
                grandeza: 'nivel',
                operador: '>=',
                limite: 500,
                duracao: { leituras: 3 },
                saida: { operador: '<', limite: 450 },
              },
            }),
          )
          .expect(201)
      ).body.id;
      ruleUnderTest = ruleId;
      base = Date.now();
    });

    it('8a. três leituras acima do limite abrem um alarme e publicam alarm.opened; a saída resolve', async () => {
      const device = devices['motor-01']!;
      await send(device, 40, 510);
      await send(device, 39, 520);
      await settle();
      expect(await alarmRows(device)).toEqual([]);

      await send(device, 38, 530);
      const [alarm] = await eventually(async () => {
        const rows = await alarmRows(device);
        return rows.length > 0 ? rows : undefined;
      });
      expect(alarm).toMatchObject({
        state: 'ATIVO',
        severity: 'alta',
        rule_id: ruleId,
        occurred_at: new Date(base - 38_000),
      });
      const opened = await eventually(async () => {
        const events = await streamEvents('alarm.opened', device);
        return events.length > 0 ? events : undefined;
      });
      expect(opened).toEqual([
        expect.objectContaining({
          type: 'alarm.opened',
          alarmId: alarm.id,
          ruleId,
          tenantId: expect.any(String),
          severity: 'alta',
          state: 'ATIVO',
          occurredAt: new Date(base - 38_000).toISOString(),
        }),
      ]);

      // Continuar acima não reabre; cair abaixo da saída resolve automaticamente.
      await send(device, 37, 540);
      await send(device, 36, 440);
      const resolved = await eventually(async () => {
        const events = await streamEvents('alarm.resolved', device);
        return events.length > 0 ? events : undefined;
      });
      expect(resolved).toEqual([
        expect.objectContaining({ alarmId: alarm.id, state: 'RESOLVIDO' }),
      ]);
      expect((await alarmRows(device)).map((r) => r.state)).toEqual(['RESOLVIDO']);
    });

    it('8b. reiniciar o core-api no meio da condição não perde nem duplica', async () => {
      const device = devices['motor-02']!;
      await send(device, 30, 510);
      await send(device, 29, 520);
      await settle();
      await t.crashApp();
      await t.startApp();

      await send(device, 28, 530);
      await eventually(async () => ((await alarmRows(device)).length > 0 ? true : undefined));

      // Reentrega do mesmo evento (como depois de uma queda antes do XACK) não muda nada.
      const [last] = await t.redis.xrevrange('measurement.ingested', '+', '-', 'COUNT', 1);
      await t.redis.xadd('measurement.ingested', '*', 'evento', last![1][1]!);
      await settle();
      expect(await alarmRows(device)).toHaveLength(1);
      expect(await streamEvents('alarm.opened', device)).toHaveLength(1);
    });

    it('8c. medição atrasada fica no histórico e não avalia a regra', async () => {
      const device = devices['motor-03']!;
      // Mais antiga que 3 intervalos esperados (180 s): late.
      await send(device, 400, 510);
      await send(device, 399, 520);
      await send(device, 398, 530);
      await settle();
      expect(await alarmRows(device)).toEqual([]);
    });
  });
});
