import type { AbsenceState, PairState, RuleStatePort } from '@iot/domain';
import type Redis from 'ioredis';

const key = (ruleId: string, deviceId: string) => `regras:estado:${ruleId}:${deviceId}`;

// RuleStatePort no Redis: um hash por par, com o estado do par e o da ausência em campos
// separados. Sem expiração, para sobreviver a reinício do core-api (o Redis do compose tem AOF).
// O motor central usa o adaptador PostgreSQL, na mesma transação do alarme (ADR-021).
export class RedisRuleState implements RuleStatePort {
  constructor(private readonly redis: Redis) {}

  async get(ruleId: string, deviceId: string): Promise<PairState | null> {
    const raw = await this.redis.hget(key(ruleId, deviceId), 'par');
    return raw === null ? null : (JSON.parse(raw) as PairState);
  }

  async save(_tenantId: string, ruleId: string, deviceId: string, state: PairState) {
    await this.redis.hset(key(ruleId, deviceId), 'par', JSON.stringify(state));
  }

  async getAbsence(ruleId: string, deviceId: string): Promise<AbsenceState | null> {
    const raw = await this.redis.hget(key(ruleId, deviceId), 'ausencia');
    return raw === null ? null : (JSON.parse(raw) as AbsenceState);
  }

  async saveAbsence(_tenantId: string, ruleId: string, deviceId: string, state: AbsenceState) {
    await this.redis.hset(key(ruleId, deviceId), 'ausencia', JSON.stringify(state));
  }
}
