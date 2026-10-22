import type { EventBusPort, IngestionEvent } from '@iot/domain';
import type Redis from 'ioredis';

// Barramento interno com Redis Streams (ADR-004): um stream por tipo de evento,
// com o evento inteiro em JSON no campo "evento".
export class RedisStreamsEventBus implements EventBusPort {
  constructor(
    private readonly redis: Redis,
    private readonly maxLength: number,
  ) {}

  async publishAll(events: IngestionEvent[]): Promise<void> {
    if (events.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const event of events) {
      pipeline.xadd(
        event.type,
        'MAXLEN',
        '~',
        this.maxLength,
        '*',
        'evento',
        JSON.stringify(event),
      );
    }
    const results = await pipeline.exec();
    const failed = results?.find(([error]) => error);
    if (failed) throw failed[0];
  }
}
