import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import mqtt from 'mqtt';
import { initialPairState, type RuleStatePort } from '@iot/domain';
import { PgRuleState } from '../../src/rules/pg-rule-state';
import { RedisRuleState } from '../../src/rules/redis-rule-state';
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
    // Varredura de ausência curta, para o teste não esperar 30 s.
    t = await startTestApp({ RULES_ABSENCE_SWEEP_MS: '300' });
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

  describe('API de alarmes (RF-PRO-05)', () => {
    let ruleId: string;
    let device: Device;
    let alarmId: string;
    let domainId: string;
    let areaId: string;
    let farAreaId: string;
    const square = (x: number, y: number, size: number) => ({
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    });

    beforeAll(async () => {
      device = await createDevice('alarme-01');
      domainId = (await a().get(`/dispositivos/${device.id}`).expect(200)).body.dominio_id;
      areaId = (
        await a()
          .post('/areas', {
            site_id: siteId,
            slug: 'perto',
            nome: 'Perto',
            geometria: square(-49, -17, 1),
          })
          .expect(201)
      ).body.id;
      farAreaId = (
        await a()
          .post('/areas', {
            site_id: siteId,
            slug: 'longe',
            nome: 'Longe',
            geometria: square(10, 10, 1),
          })
          .expect(201)
      ).body.id;
      ruleId = (
        await a()
          .post(
            '/regras',
            levelRule({
              nome: 'alarmes: nível crítico',
              condicao: {
                grandeza: 'nivel',
                operador: '>=',
                limite: 900,
                duracao: { leituras: 2 },
              },
              acoes: [{ tipo: 'gerar_alarme', severidade: 'critica' }],
            }),
          )
          .expect(201)
      ).body.id;
      ruleUnderTest = ruleId;
      base = Date.now();
      await send(device, 50, 910);
      await send(device, 49, 920);
      alarmId = (await eventually(async () => (await alarmRows(device))[0]))!.id;
    });

    it('lista com filtros de estado, severidade, área e domínio, no contrato', async () => {
      const list = await a().get('/alarmes?estado=ativo&severidade=critica').expect(200);
      expect(contract.validate('PaginaAlarmes', list.body).errors).toEqual([]);
      const mine = list.body.itens.filter((i: { id: string }) => i.id === alarmId);
      expect(mine).toEqual([
        expect.objectContaining({
          regra_id: ruleId,
          regra_nome: 'alarmes: nível crítico',
          dispositivo_id: device.id,
          dispositivo_slug: 'alarme-01',
          severidade: 'critica',
          estado: 'ativo',
          ocorrido_em: new Date(base - 49_000).toISOString(),
          reconhecido_em: null,
          resolucao: null,
        }),
      ]);
      const ids = async (query: string) =>
        (await a().get(`/alarmes?${query}`).expect(200)).body.itens.map(
          (i: { id: string }) => i.id,
        );
      expect(await ids('severidade=baixa')).not.toContain(alarmId);
      expect(await ids('estado=resolvido')).not.toContain(alarmId);
      expect(await ids(`area=${areaId}`)).toContain(alarmId);
      expect(await ids(`area=${farAreaId}`)).toEqual([]);
      expect(await ids(`dominio=${domainId}`)).toContain(alarmId);
      expect(await ids('dominio=00000000-0000-4000-8000-000000000000')).toEqual([]);
      await a().get('/alarmes?estado=ATIVO').expect(400);
      await a().get('/alarmes?area=abc').expect(400);
    });

    it('detalhe traz a linha do tempo', async () => {
      const detail = await a().get(`/alarmes/${alarmId}`).expect(200);
      expect(contract.validate('AlarmeDetalhado', detail.body).errors).toEqual([]);
      expect(detail.body.linha_do_tempo).toEqual([
        {
          tipo: 'aberto',
          em: detail.body.aberto_em,
          medido_em: new Date(base - 49_000).toISOString(),
        },
      ]);
      await a().get('/alarmes/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('reconhecer exige autor, aceita nota e publica alarm.updated; reconhecer de novo é conflito', async () => {
      const missing = await a().patch(`/alarmes/${alarmId}/reconhecer`, {}).expect(401);
      expect(contract.validate('Erro', missing.body).errors).toEqual([]);

      const acked = await a()
        .patch(`/alarmes/${alarmId}/reconhecer`, { nota: 'equipe a caminho' })
        .set('X-Ator', 'operador-1')
        .expect(200);
      expect(contract.validate('AlarmeDetalhado', acked.body).errors).toEqual([]);
      expect(acked.body).toMatchObject({
        estado: 'reconhecido',
        reconhecido_por: 'operador-1',
        nota_reconhecimento: 'equipe a caminho',
      });
      expect(acked.body.linha_do_tempo.at(-1)).toMatchObject({
        tipo: 'reconhecido',
        autor: 'operador-1',
        nota: 'equipe a caminho',
      });
      const updated = await eventually(async () => {
        const events = await streamEvents('alarm.updated', device);
        return events.length > 0 ? events : undefined;
      });
      expect(updated).toEqual([expect.objectContaining({ alarmId, state: 'RECONHECIDO' })]);

      const again = await a()
        .patch(`/alarmes/${alarmId}/reconhecer`, {})
        .set('X-Ator', 'operador-2')
        .expect(409);
      expect(again.body.mensagem).toBe('o alarme já está RECONHECIDO');
    });

    it('resolver exige motivo; depois, o par volta a contar do zero', async () => {
      await a().patch(`/alarmes/${alarmId}/resolver`, {}).set('X-Ator', 'gestor-1').expect(400);
      await a()
        .patch(`/alarmes/${alarmId}/resolver`, { motivo: '  ' })
        .set('X-Ator', 'gestor-1')
        .expect(400);

      const resolved = await a()
        .patch(`/alarmes/${alarmId}/resolver`, { motivo: 'falso positivo' })
        .set('X-Ator', 'gestor-1')
        .expect(200);
      expect(resolved.body).toMatchObject({
        estado: 'resolvido',
        resolucao: 'manual',
        resolvido_por: 'gestor-1',
        motivo_resolucao: 'falso positivo',
      });
      expect(resolved.body.linha_do_tempo.map((e: { tipo: string }) => e.tipo)).toEqual([
        'aberto',
        'reconhecido',
        'resolvido',
      ]);
      await eventually(async () =>
        (await streamEvents('alarm.resolved', device)).length > 0 ? true : undefined,
      );
      await a()
        .patch(`/alarmes/${alarmId}/resolver`, { motivo: 'de novo' })
        .set('X-Ator', 'gestor-1')
        .expect(409);

      // Ainda acima do limite: precisa de 2 leituras novas para abrir outro alarme.
      await send(device, 48, 930);
      await settle();
      expect((await alarmRows(device)).map((r) => r.state)).toEqual(['RESOLVIDO']);
      await send(device, 47, 940);
      await eventually(async () => ((await alarmRows(device)).length === 2 ? true : undefined));
    });
  });

  describe('ações e ausência (RF-PRO-03)', () => {
    let server: Server;
    let hookUrl: string;
    const hooks: Record<string, unknown>[] = [];
    let subscriber: mqtt.MqttClient;
    const published: { topic: string; payload: Record<string, unknown> }[] = [];
    let device: Device;

    const notifications = async (deviceId: string) =>
      (await t.redis.xrange('notification.requested', '-', '+'))
        .map(([, fields]) => JSON.parse(fields[1]!) as Record<string, unknown>)
        .filter((e) => e.deviceId === deviceId);

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          hooks.push(JSON.parse(body) as Record<string, unknown>);
          res.writeHead(204).end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alertas`;

      subscriber = await mqtt.connectAsync(
        `mqtt://${t.infra.env.MQTT_HOST}:${t.infra.env.MQTT_PORT}`,
        { username: t.infra.env.MQTT_INGEST_USERNAME, password: t.infra.env.MQTT_INGEST_PASSWORD },
      );
      subscriber.on('message', (topic, payload) =>
        published.push({
          topic,
          payload: JSON.parse(payload.toString()) as Record<string, unknown>,
        }),
      );
      await subscriber.subscribeAsync(['acoes/#', `${TENANT}/centro/medicao/+/comando`], {
        qos: 1,
      });

      device = await createDevice('acao-01');
      ruleUnderTest = (
        await a()
          .post(
            '/regras',
            levelRule({
              nome: 'ações: nível de ação',
              condicao: { grandeza: 'nivel', operador: '>=', limite: 700 },
              acoes: [
                { tipo: 'gerar_alarme', severidade: 'media' },
                { tipo: 'notificar', canais: ['email'], supressao_s: 900 },
                { tipo: 'webhook', url: hookUrl, tempo_limite_ms: 2000 },
                { tipo: 'publicar_topico', topico: 'acoes/alertas' },
                { tipo: 'enviar_comando', comando: { nome: 'acionar', parametros: { saida: 1 } } },
              ],
            }),
          )
          .expect(201)
      ).body.id;
      base = Date.now();
    });

    afterAll(async () => {
      await subscriber?.endAsync();
      await new Promise((resolve) => server?.close(resolve));
    });

    it('na abertura, notifica, chama o webhook, publica no tópico e envia o comando', async () => {
      await send(device, 20, 710);
      const [alarm] = await eventually(async () => {
        const rows = await alarmRows(device);
        return rows.length > 0 ? rows : undefined;
      });

      const [notification] = await eventually(async () => {
        const found = await notifications(device.id);
        return found.length > 0 ? found : undefined;
      });
      expect(notification).toMatchObject({
        type: 'notification.requested',
        channels: ['email'],
        kind: 'abertura',
        alarmId: alarm.id,
        severity: 'media',
        ruleName: 'ações: nível de ação',
        quantity: 'nivel',
        value: 710,
      });
      await eventually(async () => (hooks.length > 0 ? true : undefined));
      expect(hooks[0]).toMatchObject({
        tipo: 'alarme',
        regra_id: ruleUnderTest,
        dispositivo_id: device.id,
        alarme_id: alarm.id,
        severidade: 'media',
      });
      await eventually(async () => (published.length >= 2 ? true : undefined));
      expect(published.find((p) => p.topic === 'acoes/alertas')?.payload).toMatchObject({
        alarme_id: alarm.id,
      });
      expect(
        published.find((p) => p.topic === `${TENANT}/centro/medicao/acao-01/comando`)?.payload,
      ).toMatchObject({
        versao: '1.0',
        dispositivo: 'acao-01',
        tipo: 'comando',
        comando: { nome: 'acionar', parametros: { saida: 1 } },
      });
    });

    it('reabrir na janela de supressão não notifica de novo, mas as outras ações saem', async () => {
      await send(device, 19, 600);
      await send(device, 18, 720);
      await eventually(async () => ((await alarmRows(device)).length === 2 ? true : undefined));
      await eventually(async () => (hooks.length === 2 ? true : undefined));
      await settle();
      expect(await notifications(device.id)).toHaveLength(1);
    });

    it('ausência notifica uma vez por período, sem abrir alarme', async () => {
      const profile = (
        await a()
          .post('/perfis', {
            dominio_id: (await a().get(`/dispositivos/${device.id}`).expect(200)).body.dominio_id,
            nome: 'rápido',
            intervalo_esperado_s: 1,
            grandezas: [{ nome: 'nivel', unidade: 'cm' }],
          })
          .expect(201)
      ).body;
      const quiet = (
        await a()
          .post('/dispositivos', { slug: 'ausente-01', perfil_id: profile.id, site_id: siteId })
          .expect(201)
      ).body as Device;
      ruleUnderTest = (
        await a()
          .post('/regras', {
            nome: 'ausência: sem medidas',
            escopo: 'central',
            ativa: true,
            condicao: { ausencia: { intervalos: 2 } },
            acoes: [{ tipo: 'notificar', canais: ['sms'] }],
          })
          .expect(201)
      ).body.id;
      base = Date.now();
      await send(quiet, 0, 1);

      const found = await eventually(async () => {
        const list = (await notifications(quiet.id)).filter((n) => n.kind === 'ausencia');
        return list.length > 0 ? list : undefined;
      });
      expect(found[0]).toMatchObject({ channels: ['sms'], ruleId: ruleUnderTest });
      expect(found[0]).not.toHaveProperty('alarmId');
      await settle();
      expect((await notifications(quiet.id)).filter((n) => n.kind === 'ausencia')).toHaveLength(1);
      expect(await alarmRows(quiet)).toEqual([]);
    });
  });

  // O mesmo contrato da porta vale para os dois adaptadores; uma instância nova (como depois de
  // um reinício) lê o que a anterior gravou.
  describe.each([
    ['PostgreSQL', () => new PgRuleState(t.db)],
    ['Redis', () => new RedisRuleState(t.redis)],
  ] as [string, () => RuleStatePort][])('RuleStatePort no %s', (_name, create) => {
    let tenantId: string;
    let ruleId: string;
    let deviceId: string;

    beforeAll(async () => {
      const device = await createDevice(`estado-${_name.toLowerCase()}`);
      deviceId = device.id;
      const rule = (
        await a()
          .post('/regras', levelRule({ nome: `estado ${_name}`, ativa: false }))
          .expect(201)
      ).body;
      ruleId = rule.id;
      tenantId = (await t.db.query('SELECT tenant_id FROM rules WHERE id = $1', [ruleId])).rows[0]
        .tenant_id;
    });

    it('sem estado, devolve null; o estado gravado sobrevive a uma instância nova', async () => {
      expect(await create().get(ruleId, deviceId)).toBeNull();
      const state = {
        ...initialPairState(),
        lastTs: 1_700_000_000_000,
        window: [{ t: 1_700_000_000_000, v: 3.5 }],
        enter: { since: 1_699_999_999_000, count: 2 },
      };
      await create().save(tenantId, ruleId, deviceId, state);
      expect(await create().get(ruleId, deviceId)).toEqual(state);
      const next = { ...state, open: true, enter: { since: null, count: 0 } };
      await create().save(tenantId, ruleId, deviceId, next);
      expect(await create().get(ruleId, deviceId)).toEqual(next);
    });

    it('o estado da ausência é separado do estado do par', async () => {
      expect(await create().getAbsence(ruleId, deviceId)).toBeNull();
      await create().saveAbsence(tenantId, ruleId, deviceId, { notifiedFor: 42 });
      expect(await create().getAbsence(ruleId, deviceId)).toEqual({ notifiedFor: 42 });
      expect((await create().get(ruleId, deviceId))?.open).toBe(true);
    });
  });

  // Roda depois dos blocos acima, que abriram e resolveram alarmes (automática e manual).
  describe('métricas do motor (RNF-02, RF-OBS-01)', () => {
    it('/metrics conta alarmes abertos e resolvidos e mede a latência até a abertura', async () => {
      const text = (await api().get('/metrics').expect(200)).text;
      const value = (line: RegExp) => Number(text.match(line)?.[1] ?? NaN);
      expect(value(/^alarmes_abertos_total\{severidade="alta"\} (\d+)/m)).toBeGreaterThanOrEqual(2);
      expect(value(/^alarmes_abertos_total\{severidade="critica"\} (\d+)/m)).toBeGreaterThanOrEqual(
        2,
      );
      expect(
        value(/^alarmes_resolvidos_total\{resolucao="automatica"\} (\d+)/m),
      ).toBeGreaterThanOrEqual(1);
      expect(value(/^alarmes_resolvidos_total\{resolucao="manual"\} (\d+)/m)).toBe(1);
      const count = value(/^regras_latencia_abertura_alarme_segundos_count (\d+)/m);
      expect(count).toBeGreaterThanOrEqual(4);
      const within3s = value(/^regras_latencia_abertura_alarme_segundos_bucket\{le="3"\} (\d+)/m);
      expect(within3s).toBe(count);
    });
  });
});
