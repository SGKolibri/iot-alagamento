import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';
import {
  account,
  brokerCounters,
  drain,
  publishBurst,
  type LoadTarget,
} from '../support/mqtt-load';

const TENANT = 'inquilino-carga';
const SYS_TOPICS = [
  '$SYS/broker/publish/messages/dropped',
  '$SYS/broker/messages/received',
  '$SYS/broker/messages/sent',
  '$SYS/broker/store/messages/count',
];

function report(label: string, data: unknown): void {
  process.stdout.write(`\n[contabilidade] ${label}: ${JSON.stringify(data)}\n`);
}

// RNF-10: toda mensagem publicada com QoS 1 e confirmada (PUBACK) termina em measurements ou em
// dead_letters. Definição do handoff T1-vazão.
describe('contabilidade MQTT sob rajada (RNF-10)', () => {
  let t: TestApp;
  let target: LoadTarget;

  beforeAll(async () => {
    t = await startTestApp();
    await createTenant(t.db, TENANT);
    const api = async (path: string, body: object) =>
      (
        await request(t.app.getHttpServer())
          .post(`/api/v1${path}`)
          .set('X-Tenant', TENANT)
          .send(body)
          .expect(201)
      ).body;
    const dominio = await api('/catalogo/dominios', { slug: 'carga', nome: 'Carga' });
    const perfil = await api('/perfis', {
      dominio_id: dominio.id,
      nome: 'termômetro',
      intervalo_esperado_s: 60,
      grandezas: [{ nome: 'temperatura', unidade: 'Cel' }],
    });
    const site = await api('/sites', { slug: 'laboratorio', nome: 'Laboratório' });
    await api('/dispositivos', { slug: 'sensor-carga', perfil_id: perfil.id, site_id: site.id });
    target = {
      url: `mqtt://${t.infra.env.MQTT_HOST}:${t.infra.env.MQTT_PORT}`,
      username: t.infra.env.MQTT_INGEST_USERNAME!,
      password: t.infra.env.MQTT_INGEST_PASSWORD!,
      topic: `${TENANT}/laboratorio/carga/sensor-carga/telemetria`,
      device: 'sensor-carga',
    };
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  it('20 publicadores, 10.000 mensagens o mais rápido possível: nada confirmado se perde', async () => {
    const burst = await publishBurst(target, 20, 10_000);
    report('rajada', {
      confirmadas: burst.confirmed.length,
      falhas: burst.failed,
      duracao_ms: burst.elapsedMs,
    });
    const result = await drain(t.db, burst.confirmed, 60_000);
    report('após drenagem', result);
    report('broker $SYS', await brokerCounters(target, SYS_TOPICS));
    expect(burst.confirmed).toHaveLength(10_000);
    expect(result).toEqual({
      confirmed: 10_000,
      stored: result.stored,
      deadLetters: result.deadLetters,
      missing: 0,
    });
    expect(result.stored + result.deadLetters).toBe(10_000);
    expect(await account(t.db, burst.confirmed)).toMatchObject({ missing: 0 });
  }, 240_000);
});
