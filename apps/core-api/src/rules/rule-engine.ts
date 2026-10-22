import {
  evaluatePoint,
  initialPairState,
  openAlarm,
  resolveAlarmAutomatically,
  type Alarm,
  type ClockPort,
  type LoggerPort,
  type RuleDefinition,
} from '@iot/domain';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AlarmPublisher } from '../alarms/alarm-publisher';
import type { AlarmsRepository } from '../alarms/alarms.repository';
import type { ActionRunner } from './action-runner';
import type { DeviceAddresses } from './device-addresses';
import { PgRuleState } from './pg-rule-state';
import type { RuleCatalog } from './rule-catalog';

export interface IngestedEvent {
  tenantId: string;
  deviceId: string;
  deviceSlug: string;
  messageId: string;
  timestamp: string;
  late: boolean;
  measurements: { quantity: string; value: number }[];
}

// Abertura sem gerar_alarme (só ações) não tem alarme.
type Outcome = { type: 'opened' | 'resolved'; alarm: Alarm | null } | null;

// Avalia as regras centrais do inquilino sobre cada measurement.ingested (RF-PRO-02). O estado
// do par, o alarme e a linha do tempo mudam na mesma transação; o evento no barramento sai
// depois do commit.
export class RuleEngine {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: RuleCatalog,
    private readonly alarms: AlarmsRepository,
    private readonly publisher: AlarmPublisher,
    private readonly clock: ClockPort,
    private readonly logger: LoggerPort,
    private readonly actions: ActionRunner,
    private readonly addresses: DeviceAddresses,
  ) {}

  async handle(event: IngestedEvent): Promise<void> {
    // Medição atrasada fica no histórico e não avalia condição de estado atual (PRD, seção 11).
    if (event.late) return;
    const rules = await this.catalog.activeCentral(event.tenantId);
    for (const rule of rules) {
      const { quantity, areaId, absence } = rule.condition;
      if (absence || quantity === undefined) continue;
      const measurement = event.measurements.find((m) => m.quantity === quantity);
      if (!measurement) continue;
      if (areaId && !(await this.catalog.deviceInArea(event.tenantId, areaId, event.deviceId)))
        continue;
      const outcome = await this.evaluate(rule, event, measurement.value);
      if (!outcome) continue;
      if (outcome.alarm) await this.publisher.publish(`alarm.${outcome.type}`, outcome.alarm);
      if (outcome.type === 'opened') {
        this.actions.run(rule, {
          tenantId: event.tenantId,
          rule: { id: rule.id, name: rule.name, version: rule.version },
          device: await this.addresses.get(event.tenantId, event.deviceId),
          ...(outcome.alarm ? { alarmId: outcome.alarm.id, severity: outcome.alarm.severity } : {}),
          kind: 'abertura',
          occurredAt: new Date(event.timestamp),
          quantity: measurement.quantity,
          value: measurement.value,
        });
      }
    }
  }

  private async evaluate(rule: RuleDefinition, event: IngestedEvent, value: number) {
    return this.transaction(async (client): Promise<Outcome> => {
      const states = new PgRuleState(client);
      const state =
        (await states.getForUpdate(event.tenantId, rule.id, event.deviceId)) ?? initialPairState();
      const t = Date.parse(event.timestamp);
      const result = evaluatePoint(rule.condition, state, { t, v: value, late: false });
      // Ponto repetido ou fora de ordem: o mesmo estado volta, e nada muda.
      if (result.state === state) return null;
      await states.save(event.tenantId, rule.id, event.deviceId, result.state);
      if (!result.effect) return null;

      const alarmAction = rule.actions.find((a) => a.type === 'alarm');
      if (result.effect.type === 'open') {
        if (!alarmAction) return { type: 'opened', alarm: null };
        const alarm = openAlarm({
          id: randomUUID(),
          tenantId: event.tenantId,
          ruleId: rule.id,
          ruleVersion: rule.version,
          deviceId: event.deviceId,
          severity: alarmAction.severity,
          occurredAt: new Date(result.effect.occurredAt),
          now: this.clock.now(),
        });
        await this.alarms.insert(client, alarm);
        return { type: 'opened', alarm };
      }
      const open = await this.alarms.findOpen(client, event.tenantId, rule.id, event.deviceId);
      if (!open) return null;
      const resolved = resolveAlarmAutomatically(
        open,
        new Date(result.effect.occurredAt),
        this.clock.now(),
      );
      await this.alarms.update(client, open, resolved);
      return { type: 'resolved', alarm: resolved };
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error({ erro: String(error) }, 'falha ao avaliar regra');
      throw error;
    } finally {
      client.release();
    }
  }
}
