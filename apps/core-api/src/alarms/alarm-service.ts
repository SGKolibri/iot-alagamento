import {
  acknowledgeAlarm,
  afterManualResolution,
  resolveAlarmManually,
  type Alarm,
  type ClockPort,
} from '@iot/domain';
import type { Pool, PoolClient } from 'pg';
import { PgRuleState } from '../rules/pg-rule-state';
import type { AlarmPublisher } from './alarm-publisher';
import type { AlarmsRepository } from './alarms.repository';

// Reconhecimento e resolução manual (RF-PRO-05). A linha do alarme fica travada durante a
// transição; na resolução manual, o estado do par volta a contar do zero na mesma transação.
// O evento no barramento sai depois do commit.
export class AlarmService {
  constructor(
    private readonly pool: Pool,
    private readonly alarms: AlarmsRepository,
    private readonly publisher: AlarmPublisher,
    private readonly clock: ClockPort,
  ) {}

  async acknowledge(tenantId: string, id: string, actor: string, note: string | undefined) {
    const alarm = await this.transition(tenantId, id, (current) =>
      acknowledgeAlarm(current, actor, note, this.clock.now()),
    );
    if (alarm) await this.publisher.publish('alarm.updated', alarm);
    return alarm;
  }

  async resolve(tenantId: string, id: string, actor: string, reason: string) {
    const alarm = await this.transition(tenantId, id, async (current, client) => {
      const resolved = resolveAlarmManually(current, actor, reason, this.clock.now());
      const states = new PgRuleState(client);
      const state = await states.getForUpdate(tenantId, current.ruleId, current.deviceId);
      if (state) {
        await states.save(tenantId, current.ruleId, current.deviceId, afterManualResolution(state));
      }
      return resolved;
    });
    if (alarm) await this.publisher.publish('alarm.resolved', alarm);
    return alarm;
  }

  // null: alarme inexistente no inquilino. Transição inválida lança AlarmTransitionError.
  private async transition(
    tenantId: string,
    id: string,
    change: (alarm: Alarm, client: PoolClient) => Alarm | Promise<Alarm>,
  ): Promise<Alarm | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.alarms.find(client, tenantId, id, true);
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      const next = await change(current, client);
      await this.alarms.update(client, current, next);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
