import type { Measurement, MeasurementRepositoryPort } from '@iot/domain';

interface Waiter {
  rows: Measurement[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

// Gravação em grupo (T1-vazão, ADR-017): as chamadas que chegam dentro de `maxWaitMs`, ou até
// `maxRows` linhas, viram um único INSERT de várias linhas. Cada chamador só é liberado depois do
// commit do grupo, e um erro rejeita todos eles: a confirmação continua vindo depois da gravação.
// A idempotência fica no repositório interno (ON CONFLICT DO NOTHING).
export class BatchingMeasurementRepository implements MeasurementRepositoryPort {
  private waiters: Waiter[] = [];
  private rows = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly inner: MeasurementRepositoryPort,
    private readonly options: { maxRows: number; maxWaitMs: number },
  ) {}

  saveAll(measurements: Measurement[]): Promise<void> {
    if (measurements.length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ rows: measurements, resolve, reject });
      this.rows += measurements.length;
      if (this.rows >= this.options.maxRows) {
        void this.flush();
      } else {
        this.timer ??= setTimeout(() => void this.flush(), this.options.maxWaitMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const group = this.waiters;
    this.waiters = [];
    this.rows = 0;
    if (group.length === 0) return;
    try {
      await this.inner.saveAll(group.flatMap((waiter) => waiter.rows));
      for (const waiter of group) waiter.resolve();
    } catch (error) {
      for (const waiter of group) waiter.reject(error);
    }
  }
}
