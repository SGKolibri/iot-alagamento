import { shouldReplaceLastValue } from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';

export interface LastValue {
  quantity: string;
  value: number;
  unit: string;
  timestamp: Date;
  late: boolean;
  suspect: boolean;
  derived: boolean;
  messageId: string;
}

// Compara e grava de forma atômica no Redis: só substitui quando a medição é mais nova (mesma
// regra de shouldReplaceLastValue, aplicada dentro do Redis para valer com consumidores paralelos).
const COMPARE_AND_SET = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  local stored = cjson.decode(current)
  if tonumber(stored.t) >= tonumber(ARGV[2]) then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
return 1`;

const key = (tenantId: string, deviceId: string) => `ultimo:${tenantId}:${deviceId}`;

interface Stored {
  t: number;
  v: number;
  u: string;
  l: boolean;
  s: boolean;
  d: boolean;
  m: string;
}

// Último valor no Redis, com espelho em last_values (upsert pela mesma regra).
export class LastValuesStore {
  constructor(
    private readonly redis: Redis,
    private readonly pool: Pool,
  ) {}

  async save(tenantId: string, deviceId: string, values: LastValue[]): Promise<void> {
    // Dentro de um mesmo evento, fica a mais nova de cada grandeza.
    const newest = new Map<string, LastValue>();
    for (const value of values) {
      const current = newest.get(value.quantity);
      if (shouldReplaceLastValue(current?.timestamp ?? null, value.timestamp))
        newest.set(value.quantity, value);
    }
    for (const value of newest.values()) {
      const stored: Stored = {
        t: value.timestamp.getTime(),
        v: value.value,
        u: value.unit,
        l: value.late,
        s: value.suspect,
        d: value.derived,
        m: value.messageId,
      };
      await this.redis.eval(
        COMPARE_AND_SET,
        1,
        key(tenantId, deviceId),
        value.quantity,
        stored.t,
        JSON.stringify(stored),
      );
      await this.pool.query(
        `INSERT INTO last_values (tenant_id, device_id, quantity, ts, value, unit, late, suspect, derived, message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (device_id, quantity) DO UPDATE
           SET ts = EXCLUDED.ts, value = EXCLUDED.value, unit = EXCLUDED.unit, late = EXCLUDED.late,
               suspect = EXCLUDED.suspect, derived = EXCLUDED.derived, message_id = EXCLUDED.message_id,
               updated_at = now()
         WHERE last_values.ts < EXCLUDED.ts`,
        [
          tenantId,
          deviceId,
          value.quantity,
          value.timestamp,
          value.value,
          value.unit,
          value.late,
          value.suspect,
          value.derived,
          value.messageId,
        ],
      );
    }
  }

  // Leitura de um dispositivo pelo Redis; se o Redis não tiver nada, o espelho na tabela.
  async read(tenantId: string, deviceId: string): Promise<LastValue[]> {
    const hash = await this.redis.hgetall(key(tenantId, deviceId));
    const entries = Object.entries(hash);
    if (entries.length > 0) {
      return entries
        .map(([quantity, raw]) => {
          const s = JSON.parse(raw) as Stored;
          return {
            quantity,
            value: s.v,
            unit: s.u,
            timestamp: new Date(s.t),
            late: s.l,
            suspect: s.s,
            derived: s.d,
            messageId: s.m,
          };
        })
        .sort((a, b) => a.quantity.localeCompare(b.quantity));
    }
    return (await this.readMany(tenantId, [deviceId])).get(deviceId) ?? [];
  }

  async readMany(tenantId: string, deviceIds: string[]): Promise<Map<string, LastValue[]>> {
    const result = new Map<string, LastValue[]>();
    if (deviceIds.length === 0) return result;
    const { rows } = await this.pool.query<{
      device_id: string;
      quantity: string;
      ts: Date;
      value: number;
      unit: string;
      late: boolean;
      suspect: boolean;
      derived: boolean;
      message_id: string;
    }>(
      `SELECT device_id, quantity, ts, value, unit, late, suspect, derived, message_id
         FROM last_values WHERE tenant_id = $1 AND device_id = ANY($2::uuid[]) ORDER BY quantity`,
      [tenantId, deviceIds],
    );
    for (const row of rows) {
      const list = result.get(row.device_id) ?? [];
      list.push({
        quantity: row.quantity,
        value: row.value,
        unit: row.unit,
        timestamp: row.ts,
        late: row.late,
        suspect: row.suspect,
        derived: row.derived,
        messageId: row.message_id,
      });
      result.set(row.device_id, list);
    }
    return result;
  }
}
