import type { Measurement, MeasurementRepositoryPort } from '@iot/domain';
import { BatchingMeasurementRepository } from './batching-measurement-repository';

const m = (quantity: string): Measurement => ({
  tenantId: 't',
  deviceId: 'd',
  quantity,
  timestamp: new Date(0),
  value: 1,
  unit: 'cm',
  suspect: false,
  late: false,
  derived: false,
  messageId: 'id',
  receivedAt: new Date(0),
});

class Recorder implements MeasurementRepositoryPort {
  readonly calls: Measurement[][] = [];
  fail?: Error;
  async saveAll(measurements: Measurement[]): Promise<void> {
    this.calls.push(measurements);
    if (this.fail) throw this.fail;
  }
}

describe('BatchingMeasurementRepository (gravação em grupo)', () => {
  it('junta as chamadas da mesma janela numa gravação só e libera cada chamador', async () => {
    const inner = new Recorder();
    const repo = new BatchingMeasurementRepository(inner, { maxRows: 1000, maxWaitMs: 5 });
    await Promise.all([
      repo.saveAll([m('a')]),
      repo.saveAll([m('b'), m('c')]),
      repo.saveAll([m('d')]),
    ]);
    expect(inner.calls.map((call) => call.map((x) => x.quantity))).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('grava na hora quando o limite de linhas é atingido', async () => {
    const inner = new Recorder();
    const repo = new BatchingMeasurementRepository(inner, { maxRows: 2, maxWaitMs: 60_000 });
    await Promise.all([
      repo.saveAll([m('a')]),
      repo.saveAll([m('b')]),
      repo.saveAll([m('c'), m('d')]),
    ]);
    expect(inner.calls.map((call) => call.length)).toEqual([2, 2]);
  });

  it('erro na gravação rejeita todos os chamadores daquele grupo, e o próximo grupo segue', async () => {
    const inner = new Recorder();
    inner.fail = new Error('banco fora');
    const repo = new BatchingMeasurementRepository(inner, { maxRows: 1000, maxWaitMs: 1 });
    const results = await Promise.allSettled([repo.saveAll([m('a')]), repo.saveAll([m('b')])]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    inner.fail = undefined;
    await expect(repo.saveAll([m('c')])).resolves.toBeUndefined();
  });

  it('lista vazia não grava', async () => {
    const inner = new Recorder();
    await new BatchingMeasurementRepository(inner, { maxRows: 10, maxWaitMs: 1 }).saveAll([]);
    expect(inner.calls).toEqual([]);
  });
});
