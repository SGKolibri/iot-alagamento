import request from 'supertest';
import { startTestApp, type TestApp } from '../support/app';
import { createLoadCatalog, report } from '../support/load-catalog';
import { publishBurst, type LoadTarget } from '../support/mqtt-load';

function metric(text: string, name: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${name} `));
  return line ? Number(line.split(' ').at(-1)) : undefined;
}

// Alerta de descarte do broker: com uma fila pequena e o assinante fora, o broker descarta, e o
// monitor expõe o contador em /metrics.
describe('monitor de descarte do broker', () => {
  let t: TestApp;
  let target: LoadTarget;

  beforeAll(async () => {
    t = await startTestApp(
      { MQTT_INGEST_CONNECTIONS: '1' },
      { mosquitto: { max_queued_messages: '10', max_queued_bytes: '0', sys_interval: '1' } },
    );
    target = await createLoadCatalog(t, 'inquilino-monitor');
  }, 180_000);

  afterAll(async () => {
    delete process.env.MQTT_INGEST_CONNECTIONS;
    await t?.close();
  }, 60_000);

  it('descarte no broker aparece em mqtt_broker_dropped_messages_total', async () => {
    await t.crashApp();
    await publishBurst(target, 4, 300);
    await t.startApp();
    const deadline = Date.now() + 15_000;
    let dropped: number | undefined;
    let pending: number | undefined;
    for (;;) {
      const text = (await request(t.app.getHttpServer()).get('/metrics').expect(200))
        .text as string;
      dropped = metric(text, 'mqtt_broker_dropped_messages_total');
      pending = metric(text, 'mqtt_ingest_pending_messages');
      if ((dropped ?? 0) > 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    report('monitor do broker', { descartadas: dropped, pendentes_no_broker: pending });
    expect(dropped).toBeGreaterThanOrEqual(250);
    expect(pending).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
