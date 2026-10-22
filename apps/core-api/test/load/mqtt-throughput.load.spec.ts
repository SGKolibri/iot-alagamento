import { cpus, totalmem } from 'node:os';
import { startTestApp, type TestApp } from '../support/app';
import { IngestedCollector, percentile } from '../support/event-collector';
import { createLoadCatalog, report } from '../support/load-catalog';
import { drain, publishBurst, type LoadTarget } from '../support/mqtt-load';

// RNF-01 e RNF-02: 1.000 msg/s por 60 s com 20 publicadores, p95 da confirmação no broker até a
// gravação (evento measurement.ingested) de no máximo 2 s. Roda com pnpm test:load.
describe('vazão MQTT sustentada (RNF-01, RNF-02)', () => {
  let t: TestApp;
  let target: LoadTarget;
  let collector: IngestedCollector;

  beforeAll(async () => {
    t = await startTestApp();
    target = await createLoadCatalog(t, 'inquilino-vazao');
    collector = new IngestedCollector(t.redis.duplicate());
    await collector.start();
  }, 180_000);

  afterAll(async () => {
    await collector?.stop();
    await t?.close();
  }, 60_000);

  it('1.000 msg/s por 60 s: nada se perde, vazão sustentada e p95 até 2 s', async () => {
    const rate = Number(process.env.LOAD_RATE ?? 1000);
    const seconds = Number(process.env.LOAD_SECONDS ?? 60);
    const burst = await publishBurst(target, 20, rate * seconds, { ratePerSecond: rate });
    const accounting = await drain(t.db, burst.confirmed, 120_000);
    await new Promise((r) => setTimeout(r, 1000));
    const latencies = burst.confirmed
      .filter((id) => collector.seenAt.has(id))
      .map((id) => collector.seenAt.get(id)! - burst.confirmedAt.get(id)!);
    const first = Math.min(...burst.confirmedAt.values());
    const last = Math.max(...burst.confirmed.map((id) => collector.seenAt.get(id) ?? Infinity));
    const result = {
      maquina: `${cpus()[0]?.model} (${cpus().length} núcleos), ${Math.round(totalmem() / 1024 ** 3)} GB`,
      taxa_alvo: rate,
      segundos: seconds,
      publicacao_s: burst.elapsedMs / 1000,
      gravadas: accounting.stored,
      faltando: accounting.missing,
      vazao_msg_s: Math.round(accounting.stored / ((last - first) / 1000)),
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      max_ms: Math.max(...latencies),
    };
    report('vazão sustentada', result);
    expect(accounting.missing).toBe(0);
    expect(result.p95_ms).toBeLessThanOrEqual(2000);
    expect(result.vazao_msg_s).toBeGreaterThanOrEqual(rate * 0.98);
  }, 400_000);
});
