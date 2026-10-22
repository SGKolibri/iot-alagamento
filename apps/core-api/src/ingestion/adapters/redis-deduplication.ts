import type { DeduplicationPort } from '@iot/domain';
import type Redis from 'ioredis';

const CHUNK = 1000;
const key = (tenantId: string, id: string) => `dedup:${tenantId}:${id}`;

// Últimos id_mensagem vistos, com expiração. Depois que a chave expira, a chave primária
// da hipertabela ainda impede a duplicação da medição.
export class RedisDeduplication implements DeduplicationPort {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async findSeen(tenantId: string, messageIds: string[]): Promise<Set<string>> {
    const seen = new Set<string>();
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const ids = messageIds.slice(i, i + CHUNK);
      const values = await this.redis.mget(ids.map((id) => key(tenantId, id)));
      values.forEach((value, index) => {
        if (value !== null) seen.add(ids[index]!);
      });
    }
    return seen;
  }

  async remember(tenantId: string, messageIds: string[]): Promise<void> {
    for (let i = 0; i < messageIds.length; i += CHUNK) {
      const pipeline = this.redis.pipeline();
      for (const id of messageIds.slice(i, i + CHUNK)) {
        pipeline.set(key(tenantId, id), '1', 'EX', this.ttlSeconds);
      }
      await pipeline.exec();
    }
  }
}
