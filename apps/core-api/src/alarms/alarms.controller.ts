import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AlarmTransitionError,
  type AlarmEvent,
  type AlarmState,
  type Issue,
  type Severity,
} from '@iot/domain';
import type { Pool } from 'pg';
import {
  badRequest,
  conflict,
  listQuery,
  notFound,
  page,
  requireUuid,
} from '../catalog/http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from '../catalog/request-validator';
import { PG_POOL } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { ACTOR_CONTEXT, type ActorContextPort, type ActorRequest } from './actor-context';
import { ALARM_SORTABLE, AlarmQueries, type AlarmFilter, type AlarmSummary } from './alarm-queries';
import { AlarmService } from './alarm-service';
import { AlarmsRepository } from './alarms.repository';

// O contrato publica o estado em minúsculas desde a 1.0.0; o domínio usa ATIVO, RECONHECIDO e
// RESOLVIDO (ADR-020).
const STATE_TO_API: Record<AlarmState, string> = {
  ATIVO: 'ativo',
  RECONHECIDO: 'reconhecido',
  RESOLVIDO: 'resolvido',
};
const STATE_FROM_API: Record<string, AlarmState> = {
  ativo: 'ATIVO',
  reconhecido: 'RECONHECIDO',
  resolvido: 'RESOLVIDO',
};
const SEVERITIES = new Set<string>(['baixa', 'media', 'alta', 'critica']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toAlarme(a: AlarmSummary) {
  return {
    id: a.id,
    regra_id: a.ruleId,
    regra_versao: a.ruleVersion,
    regra_nome: a.ruleName,
    dispositivo_id: a.deviceId,
    dispositivo_slug: a.deviceSlug,
    severidade: a.severity,
    estado: STATE_TO_API[a.state],
    ocorrido_em: a.occurredAt.toISOString(),
    aberto_em: a.openedAt.toISOString(),
    reconhecido_em: iso(a.acknowledgedAt),
    reconhecido_por: a.acknowledgedBy,
    nota_reconhecimento: a.acknowledgeNote,
    resolvido_em: iso(a.resolvedAt),
    resolvido_por: a.resolvedBy,
    motivo_resolucao: a.resolveReason,
    resolucao: a.resolution,
  };
}

const toEvento = (e: AlarmEvent) => ({
  tipo: e.type,
  em: e.at.toISOString(),
  ...(e.measuredAt ? { medido_em: e.measuredAt.toISOString() } : {}),
  ...(e.actor !== undefined ? { autor: e.actor } : {}),
  ...(e.note !== undefined ? { nota: e.note } : {}),
  ...(e.reason !== undefined ? { motivo: e.reason } : {}),
});

function filterFrom(query: Record<string, unknown>): AlarmFilter {
  const issues: Issue[] = [];
  const filter: AlarmFilter = {};
  if (query.estado !== undefined) {
    const state = typeof query.estado === 'string' ? STATE_FROM_API[query.estado] : undefined;
    if (state) filter.state = state;
    else
      issues.push({
        path: 'estado',
        rule: 'consulta',
        message: 'estado é ativo, reconhecido ou resolvido',
      });
  }
  if (query.severidade !== undefined) {
    if (typeof query.severidade === 'string' && SEVERITIES.has(query.severidade))
      filter.severity = query.severidade as Severity;
    else
      issues.push({
        path: 'severidade',
        rule: 'consulta',
        message: 'severidade é baixa, media, alta ou critica',
      });
  }
  for (const [param, key] of [
    ['area', 'areaId'],
    ['dominio', 'domainId'],
  ] as const) {
    const value = query[param];
    if (value === undefined) continue;
    if (typeof value === 'string' && UUID.test(value)) filter[key] = value;
    else issues.push({ path: param, rule: 'consulta', message: `${param} precisa ser um UUID` });
  }
  if (issues.length > 0) throw badRequest(issues, 'parâmetros de listagem inválidos');
  return filter;
}

// RF-PRO-05: fila de alarmes do inquilino, com reconhecimento e resolução manual.
@Controller('alarmes')
@UseGuards(TenantGuard)
export class AlarmsController {
  private readonly queries: AlarmQueries;

  constructor(
    @Inject(AlarmsRepository) private readonly alarms: AlarmsRepository,
    @Inject(AlarmService) private readonly service: AlarmService,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    @Inject(ACTOR_CONTEXT) private readonly actors: ActorContextPort,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {
    this.queries = new AlarmQueries(this.pool);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, ALARM_SORTABLE, '-aberto_em');
    const filter = filterFrom(query);
    const { items, total } = await this.queries.list(tenant.id, filter, {
      offset: q.offset,
      limit: q.limit,
      orderBy: q.sort.field,
      direction: q.sort.direction,
    });
    return page(items.map(toAlarme), total, q);
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    return this.detail(tenant, requireUuid(id, 'alarme'));
  }

  @Patch(':id/reconhecer')
  async acknowledge(
    @CurrentTenant() tenant: TenantRef,
    @Req() request: ActorRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(request);
    const input = this.requests.assert<{ nota?: string }>('ReconhecimentoAlarme', body ?? {});
    const done = await this.transition(() =>
      this.service.acknowledge(tenant.id, requireUuid(id, 'alarme'), actor, input.nota),
    );
    return this.detail(tenant, done);
  }

  @Patch(':id/resolver')
  async resolve(
    @CurrentTenant() tenant: TenantRef,
    @Req() request: ActorRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(request);
    const input = this.requests.assert<{ motivo: string }>('ResolucaoAlarme', body ?? {});
    const done = await this.transition(() =>
      this.service.resolve(tenant.id, requireUuid(id, 'alarme'), actor, input.motivo),
    );
    return this.detail(tenant, done);
  }

  private actor(request: ActorRequest): string {
    const actor = this.actors.resolve(request);
    if (!actor) {
      throw new HttpException(
        { codigo: 'nao_autenticado', mensagem: 'autor ausente (cabeçalho X-Ator)' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return actor;
  }

  private async transition(run: () => Promise<{ id: string } | null>): Promise<string> {
    try {
      const alarm = await run();
      if (!alarm) throw notFound('alarme');
      return alarm.id;
    } catch (error) {
      if (error instanceof AlarmTransitionError) throw conflict(error.message);
      throw error;
    }
  }

  private async detail(tenant: TenantRef, id: string) {
    const [summary, alarm] = await Promise.all([
      this.queries.summary(tenant.id, id),
      this.alarms.find(this.pool, tenant.id, id),
    ]);
    if (!summary || !alarm) throw notFound('alarme');
    return { ...toAlarme(summary), linha_do_tempo: alarm.events.map(toEvento) };
  }
}
