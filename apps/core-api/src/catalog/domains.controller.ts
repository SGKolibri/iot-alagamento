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
import type { Domain, PrismaClient } from '../generated/prisma/client';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { CatalogEvents } from './catalog-events';
import { listQuery, mapDatabaseError, notFound, page, requireUuid } from './http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from './request-validator';

const SORTABLE = { slug: 'slug', nome: 'name', criado_em: 'createdAt' };

export function toDominio(d: Domain) {
  return { id: d.id, slug: d.slug, nome: d.name, criado_em: d.createdAt.toISOString() };
}

// RF-CEN-01: catálogo de domínios por inquilino.
@Controller('catalogo/dominios')
@UseGuards(TenantGuard)
export class DomainsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<{ slug: string; nome: string }>('NovoDominio', body);
    const created = await this.prisma.domain
      .create({ data: { tenantId: tenant.id, slug: input.slug, name: input.nome } })
      .catch((error: unknown) => mapDatabaseError(error, 'domínio'));
    this.events.changed();
    return toDominio(created);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, SORTABLE, 'slug');
    const where = { tenantId: tenant.id };
    const [items, total] = await Promise.all([
      this.prisma.domain.findMany({
        where,
        orderBy: { [q.sort.field]: q.sort.direction },
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.domain.count({ where }),
    ]);
    return page(items.map(toDominio), total, q);
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    return toDominio(await this.find(tenant, id));
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const input = this.requests.assert<{ nome: string }>('AlteracaoDominio', body);
    await this.find(tenant, id);
    const updated = await this.prisma.domain.update({ where: { id }, data: { name: input.nome } });
    this.events.changed();
    return toDominio(updated);
  }

  private async find(tenant: TenantRef, id: string): Promise<Domain> {
    const found = await this.prisma.domain.findFirst({
      where: { id: requireUuid(id, 'domínio'), tenantId: tenant.id },
    });
    if (!found) throw notFound('domínio');
    return found;
  }
}
