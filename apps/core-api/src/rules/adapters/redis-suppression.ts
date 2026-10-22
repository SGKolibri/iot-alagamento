import type { SuppressionPort } from '@iot/domain';
import type Redis from 'ioredis';

const PREFIX = 'regras:supressao:';
// A marca só importa dentro da janela de supressão; um dia cobre qualquer janela razoável.
const TTL_SECONDS = 24 * 3600;

// Último aviso por inquilino e dispositivo, compartilhado entre réplicas.
export class RedisSuppression implements SuppressionPort {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<{ at: Date; severity: number } | null> {
    const raw = await this.redis.get(PREFIX + key);
    if (raw === null) return null;
    const mark = JSON.parse(raw) as { at: string; severity: number };
    return { at: new Date(mark.at), severity: mark.severity };
  }

  async set(key: string, mark: { at: Date; severity: number }): Promise<void> {
    await this.redis.set(
      PREFIX + key,
      JSON.stringify({ at: mark.at.toISOString(), severity: mark.severity }),
      'EX',
      TTL_SECONDS,
    );
  }
}
