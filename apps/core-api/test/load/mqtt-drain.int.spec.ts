import { drainSessions } from '../../src/ingestion/mqtt/session-drainer';
import { MqttIngestionSubscriber } from '../../src/ingestion/mqtt/mqtt-ingestion.subscriber';
import { sharedSubscriptions } from '../../src/ingestion/mqtt/topic';
import { startTestApp, type TestApp } from '../support/app';
import { createLoadCatalog, report } from '../support/load-catalog';
import { drain, publishBurst, type LoadTarget } from '../support/mqtt-load';

// Reduzir MQTT_INGEST_CONNECTIONS deixa sessões persistentes órfãs no grupo compartilhado, com
// mensagens presas (ADR-017). pnpm mqtt:drain-sessions esvazia essas sessões e as apaga.
describe('drenagem de sessões MQTT órfãs', () => {
  let t: TestApp;
  let target: LoadTarget;

  beforeAll(async () => {
    t = await startTestApp();
    target = await createLoadCatalog(t, 'inquilino-drenagem');
  }, 180_000);

  afterAll(async () => {
    delete process.env.MQTT_INGEST_CONNECTIONS;
    await t?.close();
  }, 60_000);

  it('de 32 para 8 conexões: as sessões 9 a 32 são drenadas pelo pipeline e apagadas', async () => {
    await t.crashApp();
    const first = await publishBurst(target, 8, 3_200);
    process.env.MQTT_INGEST_CONNECTIONS = '8';
    await t.startApp();
    const stuck = await drain(t.db, first.confirmed, 20_000, 4_000);
    report('com 8 conexões, antes da drenagem', stuck);
    expect(stuck.missing).toBeGreaterThan(0);

    const subscriber = t.app.get(MqttIngestionSubscriber);
    const orphans = Array.from({ length: 24 }, (_, i) => `core-api-ingestao-${i + 8}`);
    const result = await drainSessions({
      url: target.url,
      username: target.username,
      password: target.password,
      clientIds: orphans,
      topics: sharedSubscriptions('core-api'),
      handle: (topic, payload) => subscriber.handle(topic, payload),
      idleMs: 1_000,
    });
    report('drenagem', {
      sessoes: result.length,
      mensagens: result.reduce((n, r) => n + r.drained, 0),
    });
    expect(result.reduce((n, r) => n + r.drained, 0)).toBe(stuck.missing);

    const after = await drain(t.db, first.confirmed, 10_000);
    report('depois da drenagem', after);
    expect(after.missing).toBe(0);

    // As sessões apagadas saíram do grupo: as novas mensagens vão só para as 8 conexões.
    const second = await publishBurst(target, 8, 800);
    expect((await drain(t.db, second.confirmed, 30_000)).missing).toBe(0);
  }, 240_000);
});
