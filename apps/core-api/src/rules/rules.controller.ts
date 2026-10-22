import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Issue } from '@iot/domain';
import {
  badRequest,
  conflict,
  listQuery,
  notFound,
  page,
  requireUuid,
} from '../catalog/http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from '../catalog/request-validator';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { RuleEvents } from './rule-events';
import {
  RulesRepository,
  type RuleFilter,
  type RuleInput,
  type StoredRule,
} from './rules.repository';

const SORTABLE = { nome: 'name', criado_em: 'created_at', atualizado_em: 'updated_at' };

export function toRegra(rule: StoredRule) {
  return {
    id: rule.id,
    versao: rule.versao,
    nome: rule.nome,
    escopo: rule.escopo,
    ativa: rule.ativa,
    condicao: rule.condicao,
    acoes: rule.acoes,
    criado_em: rule.criadoEm.toISOString(),
    atualizado_em: rule.atualizadoEm.toISOString(),
  };
}

function filterFrom(query: Record<string, unknown>): RuleFilter {
  const issues: Issue[] = [];
  const filter: RuleFilter = {};
  if (query.escopo !== undefined) {
    if (query.escopo === 'central' || query.escopo === 'borda') filter.escopo = query.escopo;
    else issues.push({ path: 'escopo', rule: 'consulta', message: 'escopo é central ou borda' });
  }
  if (query.ativa !== undefined) {
    if (query.ativa === 'true' || query.ativa === 'false') filter.ativa = query.ativa === 'true';
    else issues.push({ path: 'ativa', rule: 'consulta', message: 'ativa é true ou false' });
  }
  if (issues.length > 0) throw badRequest(issues, 'parâmetros de listagem inválidos');
  return filter;
}

// RF-PRO-02: regras de processamento por inquilino, validadas pelo contrato rule.v1.
@Controller('regras')
@UseGuards(TenantGuard)
export class RulesController {
  constructor(
    @Inject(RulesRepository) private readonly rules: RulesRepository,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    @Inject(RuleEvents) private readonly events: RuleEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<RuleInput & { versao?: number }>('NovaRegra', body);
    await this.requireArea(tenant, input);
    const created = await this.rules.create(tenant.id, input);
    this.events.changed(tenant.id);
    return toRegra(created);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, SORTABLE, 'criado_em');
    const filter = filterFrom(query);
    const { items, total } = await this.rules.list(tenant.id, filter, {
      offset: q.offset,
      limit: q.limit,
      orderBy: q.sort.field,
      direction: q.sort.direction,
    });
    return page(items.map(toRegra), total, q);
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    return toRegra(await this.find(tenant, id));
  }

  // Os campos enviados substituem os atuais, e a regra inteira passa de novo pelo schema.
  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const changes = this.requests.assert<Partial<RuleInput>>('AlteracaoRegra', body);
    const current = await this.find(tenant, id);
    const merged = this.requests.assert<RuleInput>('NovaRegra', {
      nome: current.nome,
      escopo: current.escopo,
      ativa: current.ativa,
      condicao: current.condicao,
      acoes: current.acoes,
      ...changes,
    });
    await this.requireArea(tenant, merged);
    const updated = await this.rules.update(tenant.id, current.id, current.versao, merged);
    if (!updated) throw conflict('a regra foi alterada por outra requisição; leia e tente de novo');
    this.events.changed(tenant.id);
    return toRegra(updated);
  }

  // area_id de outro inquilino (ou inexistente) é referência inválida, como no catálogo.
  private async requireArea(tenant: TenantRef, input: RuleInput): Promise<void> {
    const areaId = input.condicao.area_id;
    if (typeof areaId !== 'string') return;
    if (!(await this.rules.areaExists(tenant.id, areaId))) {
      throw badRequest([
        {
          path: '/condicao/area_id',
          rule: 'referencia',
          message: 'área não encontrada no inquilino',
        },
      ]);
    }
  }

  private async find(tenant: TenantRef, id: string): Promise<StoredRule> {
    const found = await this.rules.find(tenant.id, requireUuid(id, 'regra'));
    if (!found) throw notFound('regra');
    return found;
  }
}
