import { randomUUID } from 'node:crypto';
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
import type { Area, PrismaClient, Site } from '../generated/prisma/client';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { CatalogEvents } from './catalog-events';
import { geometriesOf, geometrySql } from './geometry';
import { listQuery, mapDatabaseError, notFound, page, requireUuid } from './http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from './request-validator';

export const PLACE_SORTABLE = { slug: 'slug', nome: 'name', criado_em: 'createdAt' };

function toSite(s: Site, geometry: unknown) {
  return {
    id: s.id,
    slug: s.slug,
    nome: s.name,
    geometria: geometry ?? null,
    criado_em: s.createdAt.toISOString(),
  };
}

export function toArea(a: Area, geometry: unknown) {
  return {
    id: a.id,
    site_id: a.siteId,
    slug: a.slug,
    nome: a.name,
    geometria: geometry,
    criado_em: a.createdAt.toISOString(),
  };
}

// RF-CEN-03: sites do inquilino, com geometria GeoJSON opcional (SRID 4326).
@Controller('sites')
@UseGuards(TenantGuard)
export class SitesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    private readonly events: CatalogEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<{ slug: string; nome: string; geometria?: unknown }>(
      'NovoSite',
      body,
    );
    const id = randomUUID();
    await this.prisma
      .$executeRaw`INSERT INTO sites (id, tenant_id, slug, name, geometry, updated_at)
        VALUES (${id}::uuid, ${tenant.id}::uuid, ${input.slug}, ${input.nome},
                ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.geometria)}), 4326), now())`.catch(
      (error: unknown) => mapDatabaseError(error, 'site'),
    );
    this.events.changed();
    return this.get(tenant, id);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, PLACE_SORTABLE, 'slug');
    const where = { tenantId: tenant.id };
    const [items, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        orderBy: { [q.sort.field]: q.sort.direction },
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.site.count({ where }),
    ]);
    const geometries = await geometriesOf(
      this.prisma,
      'sites',
      items.map((s) => s.id),
    );
    return page(
      items.map((s) => toSite(s, geometries.get(s.id))),
      total,
      q,
    );
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    const site = await this.find(tenant, id);
    return toSite(site, (await geometriesOf(this.prisma, 'sites', [site.id])).get(site.id));
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const input = this.requests.assert<{ nome?: string; geometria?: unknown }>(
      'AlteracaoSite',
      body,
    );
    await this.find(tenant, id);
    if (input.nome !== undefined)
      await this.prisma.site.update({ where: { id }, data: { name: input.nome } });
    if (input.geometria !== undefined) {
      await this.prisma
        .$executeRaw`UPDATE sites SET geometry = ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.geometria)}), 4326), updated_at = now() WHERE id = ${id}::uuid`.catch(
        (error: unknown) => mapDatabaseError(error, 'site'),
      );
    }
    this.events.changed();
    return this.get(tenant, id);
  }

  @Get(':id/areas')
  async areas(
    @CurrentTenant() tenant: TenantRef,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const site = await this.find(tenant, id);
    const q = listQuery(query, PLACE_SORTABLE, 'slug');
    const where = { tenantId: tenant.id, siteId: site.id };
    const [items, total] = await Promise.all([
      this.prisma.area.findMany({
        where,
        orderBy: { [q.sort.field]: q.sort.direction },
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.area.count({ where }),
    ]);
    const geometries = await geometriesOf(
      this.prisma,
      'areas',
      items.map((a) => a.id),
    );
    return page(
      items.map((a) => toArea(a, geometries.get(a.id))),
      total,
      q,
    );
  }

  private async find(tenant: TenantRef, id: string): Promise<Site> {
    const found = await this.prisma.site.findFirst({
      where: { id: requireUuid(id, 'site'), tenantId: tenant.id },
    });
    if (!found) throw notFound('site');
    return found;
  }
}
