import { startTestApp, type TestApp } from '../support/app';
import { createLoadCatalog, report } from '../support/load-catalog';
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

// RNF-10: toda mensagem publicada com QoS 1 e confirmada (PUBACK) termina em measurements ou em
// dead_letters. Definição do handoff T1-vazão.
describe('contabilidade MQTT sob rajada (RNF-10)', () => {
  let t: TestApp;
  let target: LoadTarget;

  beforeAll(async () => {
    t = await startTestApp();
    target = await createLoadCatalog(t, TENANT);
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
