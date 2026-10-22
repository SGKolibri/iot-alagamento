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
import type { Area, PrismaClient } from '../generated/prisma/client';
import { DEVICE_SORTABLE, toDispositivo } from '../devices/device-mapper';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { CatalogEvents } from './catalog-events';
import { geometriesOf, geometrySql } from './geometry';
import {
  badRequest,
  listQuery,
  mapDatabaseError,
  notFound,
  page,
  requireUuid,
} from './http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from './request-validator';
import { PLACE_SORTABLE, toArea } from './sites.controller';

// Campos de ordenação de dispositivo (nomes do Prisma) e as colunas no banco.
const SQL_COLUMNS: Record<string, string> = {
  slug: 'slug',
  status: 'status',
  lastContactAt: 'last_contact_at',
  createdAt: 'created_at',
};

// RF-CEN-03 e RF-CEN-04: áreas (polígonos) dentro de um site.
@Controller('areas')
@UseGuards(TenantGuard)
export class AreasController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<{
      site_id: string;
      slug: string;
      nome: string;
      geometria: unknown;
    }>('NovaArea', body);
    const site = await this.prisma.site.findFirst({
      where: { id: input.site_id, tenantId: tenant.id },
    });
    if (!site)
      throw badRequest([
        { path: '/site_id', rule: 'referencia', message: 'site não encontrado no inquilino' },
      ]);
    const id = randomUUID();
    await this.prisma
      .$executeRaw`INSERT INTO areas (id, tenant_id, site_id, slug, name, geometry, updated_at)
        VALUES (${id}::uuid, ${tenant.id}::uuid, ${site.id}::uuid, ${input.slug}, ${input.nome},
                ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.geometria)}), 4326), now())`.catch(
      (error: unknown) => mapDatabaseError(error, 'área'),
    );
    this.events.changed();
    return this.get(tenant, id);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, PLACE_SORTABLE, 'slug');
    const where = { tenantId: tenant.id };
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

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    const area = await this.find(tenant, id);
    return toArea(area, (await geometriesOf(this.prisma, 'areas', [area.id])).get(area.id));
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const input = this.requests.assert<{ nome?: string; geometria?: unknown }>(
      'AlteracaoArea',
      body,
    );
    await this.find(tenant, id);
    if (input.nome !== undefined)
      await this.prisma.area.update({ where: { id }, data: { name: input.nome } });
    if (input.geometria !== undefined) {
      await this.prisma
        .$executeRaw`UPDATE areas SET geometry = ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.geometria)}), 4326), updated_at = now() WHERE id = ${id}::uuid`.catch(
        (error: unknown) => mapDatabaseError(error, 'área'),
      );
    }
    this.events.changed();
    return this.get(tenant, id);
  }

  // RF-CEN-04: dispositivos cuja localização está dentro do polígono da área. ST_Covers conta
  // o ponto sobre a borda como dentro (ADR-014); o vínculo area_id do cadastro não entra aqui.
  @Get(':id/dispositivos')
  async devices(
    @CurrentTenant() tenant: TenantRef,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const area = await this.find(tenant, id);
    const q = listQuery(query, DEVICE_SORTABLE, 'slug');
    const column = SQL_COLUMNS[q.sort.field]!;
    const direction = q.sort.direction === 'desc' ? 'DESC' : 'ASC';
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; total: bigint }[]>(
      `SELECT d.id::text AS id, count(*) OVER () AS total
         FROM devices d JOIN areas a ON a.id = $1::uuid AND a.tenant_id = $2::uuid
        WHERE d.tenant_id = $2::uuid AND d.location IS NOT NULL AND ST_Covers(a.geometry, d.location)
        ORDER BY d.${column} ${direction} NULLS LAST, d.id
        LIMIT $3 OFFSET $4`,
      area.id,
      tenant.id,
      q.limit,
      q.offset,
    );
    const ids = rows.map((row) => row.id);
    const found = await this.prisma.device.findMany({
      where: { id: { in: ids }, tenantId: tenant.id },
    });
    const byId = new Map(found.map((d) => [d.id, d]));
    const locations = await geometriesOf(this.prisma, 'devices', ids);
    const items = ids.map((deviceId) =>
      toDispositivo(byId.get(deviceId)!, locations.get(deviceId)),
    );
    return page(items, Number(rows[0]?.total ?? 0), q);
  }

  private async find(tenant: TenantRef, id: string): Promise<Area> {
    const found = await this.prisma.area.findFirst({
      where: { id: requireUuid(id, 'área'), tenantId: tenant.id },
    });
    if (!found) throw notFound('área');
    return found;
  }
}
