import { evaluateAbsence, type AbsenceState, type ClockPort, type LoggerPort } from '@iot/domain';
import type { Pool } from 'pg';
import type { ActionRunner } from './action-runner';
import { PgRuleState } from './pg-rule-state';
import type { RuleCatalog } from './rule-catalog';

interface Candidate {
  id: string;
  slug: string;
  tenant: string;
  site: string;
  domain: string;
  last_contact_at: Date | null;
  expected_interval_s: number;
  absence: AbsenceState | null;
}

// Varredura periódica das regras de ausência (PRD, seção 12): avisa pelas ações da regra e
// não abre alarme. Um aviso por período de ausência, com o estado em rule_states.absence.
export class AbsenceSweep {
  private running = false;

  constructor(
    private readonly pool: Pool,
    private readonly catalog: RuleCatalog,
    private readonly actions: ActionRunner,
    private readonly clock: ClockPort,
    private readonly logger: LoggerPort,
  ) {}

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.clock.now();
      for (const rule of await this.catalog.activeAbsence()) {
        const { absence, areaId } = rule.condition;
        const { rows } = await this.pool.query<Candidate>(
          `SELECT d.id, d.slug, t.slug AS tenant, s.slug AS site, dm.slug AS domain,
                  d.last_contact_at, p.expected_interval_s, rs.absence
             FROM devices d
             JOIN tenants t ON t.id = d.tenant_id
             JOIN sites s ON s.id = d.site_id AND s.tenant_id = d.tenant_id
             JOIN domains dm ON dm.id = d.domain_id AND dm.tenant_id = d.tenant_id
             JOIN device_profiles p ON p.id = d.profile_id AND p.tenant_id = d.tenant_id
             LEFT JOIN rule_states rs ON rs.rule_id = $2 AND rs.device_id = d.id
            WHERE d.tenant_id = $1
              AND ($3::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM areas ar WHERE ar.id = $3 AND ar.tenant_id = d.tenant_id
                       AND ST_Covers(ar.geometry, d.location)))`,
          [rule.tenantId, rule.id, areaId ?? null],
        );
        const states = new PgRuleState(this.pool);
        for (const device of rows) {
          const state = device.absence ?? { notifiedFor: null };
          const result = evaluateAbsence(
            absence!,
            state,
            device.last_contact_at,
            device.expected_interval_s,
            now,
          );
          if (result.state !== state) {
            await states.saveAbsence(rule.tenantId, rule.id, device.id, result.state);
          }
          if (!result.effect) continue;
          this.actions.run(rule, {
            tenantId: rule.tenantId,
            rule: { id: rule.id, name: rule.name, version: rule.version },
            device: {
              id: device.id,
              slug: device.slug,
              topic: {
                tenant: device.tenant,
                site: device.site,
                domain: device.domain,
                device: device.slug,
              },
            },
            kind: 'ausencia',
            occurredAt: now,
          });
        }
      }
    } catch (error) {
      this.logger.error({ erro: String(error) }, 'falha na varredura de ausência');
    } finally {
      this.running = false;
    }
  }
}
