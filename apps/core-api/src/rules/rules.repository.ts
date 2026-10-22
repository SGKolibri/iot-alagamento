import type { Pool } from 'pg';

// Regra no formato do contrato rule.v1 (ADR-020), com os campos atribuídos pela plataforma.
export interface StoredRule {
  id: string;
  tenantId: string;
  versao: number;
  nome: string;
  escopo: 'central' | 'borda';
  ativa: boolean;
  condicao: Record<string, unknown>;
  acoes: Record<string, unknown>[];
  criadoEm: Date;
  atualizadoEm: Date;
}

export type RuleInput = Pick<StoredRule, 'nome' | 'escopo' | 'ativa' | 'condicao' | 'acoes'>;

export interface RuleFilter {
  escopo?: 'central' | 'borda';
  ativa?: boolean;
}

interface Row {
  id: string;
  tenant_id: string;
  version: number;
  name: string;
  scope: 'central' | 'borda';
  active: boolean;
  condition: Record<string, unknown>;
  actions: Record<string, unknown>[];
  created_at: Date;
  updated_at: Date;
}

const toRule = (r: Row): StoredRule => ({
  id: r.id,
  tenantId: r.tenant_id,
  versao: r.version,
  nome: r.name,
  escopo: r.scope,
  ativa: r.active,
  condicao: r.condition,
  acoes: r.actions,
  criadoEm: r.created_at,
  atualizadoEm: r.updated_at,
});

// Toda consulta leva o inquilino (regra inviolável 6).
export class RulesRepository {
  constructor(private readonly pool: Pool) {}

  async create(tenantId: string, input: RuleInput): Promise<StoredRule> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO rules (tenant_id, name, scope, active, condition, actions)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        tenantId,
        input.nome,
        input.escopo,
        input.ativa,
        JSON.stringify(input.condicao),
        JSON.stringify(input.acoes),
      ],
    );
    return toRule(rows[0]!);
  }

  // Grava a regra alterada e sobe a versão, desde que ninguém tenha alterado antes (versão lida).
  async update(tenantId: string, id: string, readVersion: number, input: RuleInput) {
    const { rows } = await this.pool.query<Row>(
      `UPDATE rules SET name = $4, scope = $5, active = $6, condition = $7, actions = $8,
              version = version + 1, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND version = $3 RETURNING *`,
      [
        id,
        tenantId,
        readVersion,
        input.nome,
        input.escopo,
        input.ativa,
        JSON.stringify(input.condicao),
        JSON.stringify(input.acoes),
      ],
    );
    return rows[0] ? toRule(rows[0]) : null;
  }

  async areaExists(tenantId: string, areaId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM areas WHERE id = $1 AND tenant_id = $2',
      [areaId, tenantId],
    );
    return rowCount === 1;
  }

  async find(tenantId: string, id: string): Promise<StoredRule | null> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM rules WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    return rows[0] ? toRule(rows[0]) : null;
  }

  async list(
    tenantId: string,
    filter: RuleFilter,
    page: { offset: number; limit: number; orderBy: string; direction: 'asc' | 'desc' },
  ): Promise<{ items: StoredRule[]; total: number }> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.escopo) {
      params.push(filter.escopo);
      where.push(`scope = $${params.length}`);
    }
    if (filter.ativa !== undefined) {
      params.push(filter.ativa);
      where.push(`active = $${params.length}`);
    }
    const clause = where.join(' AND ');
    const [items, total] = await Promise.all([
      this.pool.query<Row>(
        `SELECT * FROM rules WHERE ${clause}
          ORDER BY ${page.orderBy} ${page.direction}, id
          LIMIT ${page.limit} OFFSET ${page.offset}`,
        params,
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*) AS total FROM rules WHERE ${clause}`,
        params,
      ),
    ]);
    return { items: items.rows.map(toRule), total: Number(total.rows[0]!.total) };
  }
}
