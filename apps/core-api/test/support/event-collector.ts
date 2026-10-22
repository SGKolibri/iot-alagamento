import type Redis from 'ioredis';

// Lê o stream measurement.ingested (publicado só depois da gravação) e guarda o instante em que
// cada mensagem aparece.
export class IngestedCollector {
  readonly seenAt = new Map<string, number>();
  private running = true;
  private loop?: Promise<void>;
  private lastId = '$';

  constructor(private readonly redis: Redis) {}

  async start(): Promise<void> {
    const [last] = await this.redis.xrevrange('measurement.ingested', '+', '-', 'COUNT', 1);
    this.lastId = last?.[0] ?? '0-0';
    this.loop = (async () => {
      while (this.running) {
        const result = await this.redis.xread(
          'COUNT',
          10_000,
          'BLOCK',
          200,
          'STREAMS',
          'measurement.ingested',
          this.lastId,
        );
        const now = Date.now();
        for (const [, entries] of result ?? []) {
          for (const [id, fields] of entries) {
            this.lastId = id;
            const { messageId } = JSON.parse(fields[1]!) as { messageId: string };
            if (!this.seenAt.has(messageId)) this.seenAt.set(messageId, now);
          }
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.redis.disconnect();
  }
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}
