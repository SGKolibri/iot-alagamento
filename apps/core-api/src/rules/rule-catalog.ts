import type { RuleDefinition } from '@iot/domain';
import type { Pool } from 'pg';
import { toRuleDefinition } from './rule-mapper';
import type { StoredRule } from './rules.repository';

const CACHE_MS = 5_000;

// Regras centrais ativas por inquilino, em memória. Uma alteração neste processo invalida na
// hora; em outra réplica, vale em até 5 s.
export class RuleCatalog {
  private readonly cache = new Map<string, { rules: RuleDefinition[]; until: number }>();

  constructor(private readonly pool: Pool) {}

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  async activeCentral(tenantId: string): Promise<RuleDefinition[]> {
    const hit = this.cache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.rules;
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      name: string;
      scope: 'central';
      active: boolean;
      version: number;
      condition: Record<string, unknown>;
      actions: Record<string, unknown>[];
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM rules WHERE tenant_id = $1 AND scope = 'central' AND active ORDER BY created_at`,
      [tenantId],
    );
    const rules = rows.map((r) =>
      toRuleDefinition({
        id: r.id,
        tenantId: r.tenant_id,
        nome: r.name,
        escopo: r.scope,
        ativa: r.active,
        versao: r.version,
        condicao: r.condition,
        acoes: r.actions,
        criadoEm: r.created_at,
        atualizadoEm: r.updated_at,
      } satisfies StoredRule),
    );
    this.cache.set(tenantId, { rules, until: Date.now() + CACHE_MS });
    return rules;
  }

  // Dispositivo dentro do polígono da área (mesmo critério ST_Covers do ADR-014), com cache.
  private readonly areaCache = new Map<string, { inside: boolean; until: number }>();

  async deviceInArea(tenantId: string, areaId: string, deviceId: string): Promise<boolean> {
    const key = `${areaId}:${deviceId}`;
    const hit = this.areaCache.get(key);
    if (hit && hit.until > Date.now()) return hit.inside;
    const { rows } = await this.pool.query<{ inside: boolean }>(
      `SELECT coalesce(ST_Covers(a.geometry, d.location), false) AS inside
         FROM areas a JOIN devices d ON d.tenant_id = a.tenant_id
        WHERE a.id = $1 AND d.id = $2 AND a.tenant_id = $3`,
      [areaId, deviceId, tenantId],
    );
    const inside = rows[0]?.inside ?? false;
    this.areaCache.set(key, { inside, until: Date.now() + 30_000 });
    return inside;
  }
}
