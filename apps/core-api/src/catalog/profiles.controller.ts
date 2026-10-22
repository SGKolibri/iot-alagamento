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
import { applyProfileChanges, validateProfileQuantities, type QuantitySpec } from '@iot/domain';
import type { DeviceProfile, PrismaClient } from '../generated/prisma/client';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { CatalogEvents } from './catalog-events';
import { badRequest, listQuery, notFound, page, requireUuid } from './http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from './request-validator';

// Grandeza no formato do contrato (openapi.yaml, esquema Grandeza).
export interface Grandeza {
  nome: string;
  unidade: string;
  faixa?: { min?: number; max?: number };
  expressao?: string;
}

export function toQuantitySpec(g: Grandeza): QuantitySpec {
  return {
    name: g.nome,
    unit: g.unidade,
    ...(g.faixa ? { range: g.faixa } : {}),
    ...(g.expressao !== undefined ? { expression: g.expressao } : {}),
  };
}

function toGrandeza(q: QuantitySpec): Grandeza {
  return {
    nome: q.name,
    unidade: q.unit,
    ...(q.range ? { faixa: q.range } : {}),
    ...(q.expression !== undefined ? { expressao: q.expression } : {}),
  };
}

export function toPerfil(p: DeviceProfile) {
  return {
    id: p.id,
    dominio_id: p.domainId,
    nome: p.name,
    versao: p.version,
    intervalo_esperado_s: p.expectedIntervalS,
    grandezas: p.quantities as unknown as Grandeza[],
    criado_em: p.createdAt.toISOString(),
  };
}

const SORTABLE = { nome: 'name', versao: 'version', criado_em: 'createdAt' };

function assertQuantities(grandezas: Grandeza[]): QuantitySpec[] {
  const specs = grandezas.map(toQuantitySpec);
  const issues = validateProfileQuantities(specs);
  if (issues.length > 0) throw badRequest(issues, 'grandezas do perfil inválidas');
  return specs;
}

// RF-CEN-02: perfis de dispositivo, com versão que sobe quando as grandezas mudam.
@Controller('perfis')
@UseGuards(TenantGuard)
export class ProfilesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    private readonly events: CatalogEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<{
      dominio_id: string;
      nome: string;
      intervalo_esperado_s: number;
      grandezas: Grandeza[];
    }>('NovoPerfil', body);
    const specs = assertQuantities(input.grandezas);
    const domain = await this.prisma.domain.findFirst({
      where: { id: input.dominio_id, tenantId: tenant.id },
    });
    if (!domain) {
      throw badRequest([
        { path: '/dominio_id', rule: 'referencia', message: 'domínio não encontrado no inquilino' },
      ]);
    }
    const created = await this.prisma.deviceProfile.create({
      data: {
        tenantId: tenant.id,
        domainId: domain.id,
        name: input.nome,
        expectedIntervalS: input.intervalo_esperado_s,
        quantities: specs.map(toGrandeza) as object[],
      },
    });
    this.events.changed();
    return toPerfil(created);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, SORTABLE, 'nome');
    const where = { tenantId: tenant.id };
    const [items, total] = await Promise.all([
      this.prisma.deviceProfile.findMany({
        where,
        orderBy: { [q.sort.field]: q.sort.direction },
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.deviceProfile.count({ where }),
    ]);
    return page(items.map(toPerfil), total, q);
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    return toPerfil(await this.find(tenant, id));
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const input = this.requests.assert<{
      nome?: string;
      intervalo_esperado_s?: number;
      grandezas?: Grandeza[];
    }>('AlteracaoPerfil', body);
    const current = await this.find(tenant, id);
    const next = applyProfileChanges(
      {
        name: current.name,
        version: current.version,
        expectedIntervalS: current.expectedIntervalS,
        quantities: (current.quantities as unknown as Grandeza[]).map(toQuantitySpec),
      },
      {
        name: input.nome,
        expectedIntervalS: input.intervalo_esperado_s,
        quantities: input.grandezas ? assertQuantities(input.grandezas) : undefined,
      },
    );
    const updated = await this.prisma.deviceProfile.update({
      where: { id },
      data: {
        name: next.name,
        version: next.version,
        expectedIntervalS: next.expectedIntervalS,
        quantities: next.quantities.map(toGrandeza) as object[],
      },
    });
    this.events.changed();
    return toPerfil(updated);
  }

  private async find(tenant: TenantRef, id: string): Promise<DeviceProfile> {
    const found = await this.prisma.deviceProfile.findFirst({
      where: { id: requireUuid(id, 'perfil'), tenantId: tenant.id },
    });
    if (!found) throw notFound('perfil');
    return found;
  }
}
