import type { Alarm, AlarmState, Severity } from '@iot/domain';
import type { Pool } from 'pg';

export interface AlarmFilter {
  state?: AlarmState;
  severity?: Severity;
  areaId?: string;
  domainId?: string;
}

export interface AlarmSummary {
  id: string;
  ruleId: string;
  ruleVersion: number;
  ruleName: string;
  deviceId: string;
  deviceSlug: string;
  severity: Severity;
  state: AlarmState;
  occurredAt: Date;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgeNote: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolveReason: string | null;
  resolution: Alarm['resolution'] | null;
}

// Campo da API para expressão de ordenação; a severidade ordena pela gravidade.
export const ALARM_SORTABLE = {
  aberto_em: 'al.opened_at',
  ocorrido_em: 'al.occurred_at',
  severidade: "array_position(ARRAY['baixa','media','alta','critica'], al.severity)",
};

const SELECT = `
  SELECT al.id, al.rule_id AS "ruleId", al.rule_version AS "ruleVersion", r.name AS "ruleName",
         al.device_id AS "deviceId", d.slug AS "deviceSlug", al.severity, al.state,
         al.occurred_at AS "occurredAt", al.opened_at AS "openedAt",
         al.acknowledged_at AS "acknowledgedAt", al.acknowledged_by AS "acknowledgedBy",
         al.acknowledge_note AS "acknowledgeNote", al.resolved_at AS "resolvedAt",
         al.resolved_by AS "resolvedBy", al.resolve_reason AS "resolveReason", al.resolution
    FROM alarms al
    JOIN rules r ON r.id = al.rule_id AND r.tenant_id = al.tenant_id
    JOIN devices d ON d.id = al.device_id AND d.tenant_id = al.tenant_id`;

// Leitura da fila de alarmes, sempre filtrada pelo inquilino.
export class AlarmQueries {
  constructor(private readonly pool: Pool) {}

  async list(
    tenantId: string,
    filter: AlarmFilter,
    page: { offset: number; limit: number; orderBy: string; direction: 'asc' | 'desc' },
  ): Promise<{ items: AlarmSummary[]; total: number }> {
    const where = ['al.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    const add = (sql: (n: number) => string, value: unknown) => {
      params.push(value);
      where.push(sql(params.length));
    };
    if (filter.state) add((n) => `al.state = $${n}`, filter.state);
    if (filter.severity) add((n) => `al.severity = $${n}`, filter.severity);
    if (filter.domainId) add((n) => `d.domain_id = $${n}`, filter.domainId);
    if (filter.areaId) {
      add(
        (n) => `EXISTS (SELECT 1 FROM areas ar WHERE ar.id = $${n} AND ar.tenant_id = al.tenant_id
                         AND ST_Covers(ar.geometry, d.location))`,
        filter.areaId,
      );
    }
    const clause = where.join(' AND ');
    const [items, total] = await Promise.all([
      this.pool.query<AlarmSummary>(
        `${SELECT} WHERE ${clause} ORDER BY ${page.orderBy} ${page.direction}, al.id
          LIMIT ${page.limit} OFFSET ${page.offset}`,
        params,
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*) AS total FROM alarms al
           JOIN devices d ON d.id = al.device_id AND d.tenant_id = al.tenant_id
          WHERE ${clause}`,
        params,
      ),
    ]);
    return { items: items.rows, total: Number(total.rows[0]!.total) };
  }

  async summary(tenantId: string, id: string): Promise<AlarmSummary | null> {
    const { rows } = await this.pool.query<AlarmSummary>(
      `${SELECT} WHERE al.tenant_id = $1 AND al.id = $2`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }
}
