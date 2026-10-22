import type { AbsenceState, PairState, RuleStatePort } from '@iot/domain';
import type { Pool, PoolClient } from 'pg';

// RuleStatePort no PostgreSQL (tabela rule_states). Dentro de uma transação, `get` trava a
// linha do par (FOR UPDATE), para dois consumidores não avaliarem o mesmo par ao mesmo tempo.
export class PgRuleState implements RuleStatePort {
  constructor(private readonly db: Pool | PoolClient) {}

  async get(ruleId: string, deviceId: string): Promise<PairState | null> {
    const { rows } = await this.db.query<{ state: PairState | null }>(
      'SELECT state FROM rule_states WHERE rule_id = $1 AND device_id = $2 FOR UPDATE',
      [ruleId, deviceId],
    );
    return rows[0]?.state ?? null;
  }

  // Primeiro ponto do par: cria a linha antes de travar, para o FOR UPDATE ter o que travar.
  async getForUpdate(tenantId: string, ruleId: string, deviceId: string) {
    const found = await this.db.query<{ state: PairState | null }>(
      'SELECT state FROM rule_states WHERE rule_id = $1 AND device_id = $2 FOR UPDATE',
      [ruleId, deviceId],
    );
    if (found.rows[0]) return found.rows[0].state;
    await this.db.query(
      `INSERT INTO rule_states (tenant_id, rule_id, device_id) VALUES ($1, $2, $3)
       ON CONFLICT (rule_id, device_id) DO NOTHING`,
      [tenantId, ruleId, deviceId],
    );
    return this.get(ruleId, deviceId);
  }

  async save(tenantId: string, ruleId: string, deviceId: string, state: PairState) {
    await this.db.query(
      `INSERT INTO rule_states (tenant_id, rule_id, device_id, state) VALUES ($1, $2, $3, $4)
       ON CONFLICT (rule_id, device_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [tenantId, ruleId, deviceId, JSON.stringify(state)],
    );
  }

  async getAbsence(ruleId: string, deviceId: string): Promise<AbsenceState | null> {
    const { rows } = await this.db.query<{ absence: AbsenceState | null }>(
      'SELECT absence FROM rule_states WHERE rule_id = $1 AND device_id = $2',
      [ruleId, deviceId],
    );
    return rows[0]?.absence ?? null;
  }

  async saveAbsence(tenantId: string, ruleId: string, deviceId: string, state: AbsenceState) {
    await this.db.query(
      `INSERT INTO rule_states (tenant_id, rule_id, device_id, absence) VALUES ($1, $2, $3, $4)
       ON CONFLICT (rule_id, device_id) DO UPDATE SET absence = EXCLUDED.absence, updated_at = now()`,
      [tenantId, ruleId, deviceId, JSON.stringify(state)],
    );
  }
}
