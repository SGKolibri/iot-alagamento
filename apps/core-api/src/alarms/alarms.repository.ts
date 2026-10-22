import type { Alarm, AlarmEvent, AlarmState, Severity } from '@iot/domain';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

interface AlarmRow {
  id: string;
  tenant_id: string;
  rule_id: string;
  rule_version: number;
  device_id: string;
  severity: Severity;
  state: AlarmState;
  occurred_at: Date;
  opened_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  acknowledge_note: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolve_reason: string | null;
  resolution: 'manual' | 'automatica' | null;
}

interface EventRow {
  alarm_id: string;
  type: AlarmEvent['type'];
  at: Date;
  measured_at: Date | null;
  actor: string | null;
  note: string | null;
  reason: string | null;
}

const toEvent = (r: EventRow): AlarmEvent => ({
  type: r.type,
  at: r.at,
  ...(r.measured_at ? { measuredAt: r.measured_at } : {}),
  ...(r.actor !== null ? { actor: r.actor } : {}),
  ...(r.note !== null ? { note: r.note } : {}),
  ...(r.reason !== null ? { reason: r.reason } : {}),
});

const toAlarm = (r: AlarmRow, events: AlarmEvent[]): Alarm => ({
  id: r.id,
  tenantId: r.tenant_id,
  ruleId: r.rule_id,
  ruleVersion: r.rule_version,
  deviceId: r.device_id,
  severity: r.severity,
  state: r.state,
  occurredAt: r.occurred_at,
  openedAt: r.opened_at,
  ...(r.acknowledged_at ? { acknowledgedAt: r.acknowledged_at } : {}),
  ...(r.acknowledged_by !== null ? { acknowledgedBy: r.acknowledged_by } : {}),
  ...(r.acknowledge_note !== null ? { acknowledgeNote: r.acknowledge_note } : {}),
  ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
  ...(r.resolved_by !== null ? { resolvedBy: r.resolved_by } : {}),
  ...(r.resolution !== null ? { resolution: r.resolution } : {}),
  ...(r.resolve_reason !== null ? { resolveReason: r.resolve_reason } : {}),
  events,
});

// Alarmes e linha do tempo. Os eventos só são acrescentados: gravar um alarme grava os eventos
// que ainda não estão no banco.
export class AlarmsRepository {
  async insert(db: Db, alarm: Alarm): Promise<void> {
    await db.query(
      `INSERT INTO alarms (id, tenant_id, rule_id, rule_version, device_id, severity, state,
                           occurred_at, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        alarm.id,
        alarm.tenantId,
        alarm.ruleId,
        alarm.ruleVersion,
        alarm.deviceId,
        alarm.severity,
        alarm.state,
        alarm.occurredAt,
        alarm.openedAt,
      ],
    );
    await this.appendEvents(db, alarm, alarm.events);
  }

  async update(db: Db, before: Alarm, after: Alarm): Promise<void> {
    await db.query(
      `UPDATE alarms SET state = $3, acknowledged_at = $4, acknowledged_by = $5,
              acknowledge_note = $6, resolved_at = $7, resolved_by = $8, resolve_reason = $9,
              resolution = $10
        WHERE id = $1 AND tenant_id = $2`,
      [
        after.id,
        after.tenantId,
        after.state,
        after.acknowledgedAt ?? null,
        after.acknowledgedBy ?? null,
        after.acknowledgeNote ?? null,
        after.resolvedAt ?? null,
        after.resolvedBy ?? null,
        after.resolveReason ?? null,
        after.resolution ?? null,
      ],
    );
    await this.appendEvents(db, after, after.events.slice(before.events.length));
  }

  async findOpen(db: Db, tenantId: string, ruleId: string, deviceId: string) {
    const { rows } = await db.query<AlarmRow>(
      `SELECT * FROM alarms WHERE tenant_id = $1 AND rule_id = $2 AND device_id = $3
          AND state <> 'RESOLVIDO' FOR UPDATE`,
      [tenantId, ruleId, deviceId],
    );
    return rows[0] ? this.withEvents(db, rows[0]) : null;
  }

  // Com `lock`, trava a linha do alarme até o fim da transação (reconhecer e resolver).
  async find(db: Db, tenantId: string, id: string, lock = false): Promise<Alarm | null> {
    const { rows } = await db.query<AlarmRow>(
      `SELECT * FROM alarms WHERE id = $1 AND tenant_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [id, tenantId],
    );
    return rows[0] ? this.withEvents(db, rows[0]) : null;
  }

  private async withEvents(db: Db, row: AlarmRow): Promise<Alarm> {
    const { rows } = await db.query<EventRow>(
      'SELECT * FROM alarm_events WHERE alarm_id = $1 AND tenant_id = $2 ORDER BY id',
      [row.id, row.tenant_id],
    );
    return toAlarm(row, rows.map(toEvent));
  }

  private async appendEvents(db: Db, alarm: Alarm, events: AlarmEvent[]): Promise<void> {
    for (const e of events) {
      await db.query(
        `INSERT INTO alarm_events (tenant_id, alarm_id, type, at, measured_at, actor, note, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          alarm.tenantId,
          alarm.id,
          e.type,
          e.at,
          e.measuredAt ?? null,
          e.actor ?? null,
          e.note ?? null,
          e.reason ?? null,
        ],
      );
    }
  }
}
