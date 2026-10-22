import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { badRequest, listQuery, notFound, page, requireUuid } from '../catalog/http-errors';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { LastValuesConsumer } from './last-values.consumer';
import type { LastValue } from './last-values.store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['NUNCA_CONECTADO', 'ONLINE', 'SEM_SINAL']);
const SORTABLE = { slug: 'slug', estado: 'status', ultimo_contato_em: 'last_contact_at' };

interface DeviceRow {
  id: string;
  slug: string;
  status: string;
  last_contact_at: Date | null;
}

function toUltimoValor(v: LastValue) {
  return {
    grandeza: v.quantity,
    valor: v.value,
    unidade: v.unit,
    timestamp: v.timestamp.toISOString(),
    atrasada: v.late,
    suspeita: v.suspect,
    derivada: v.derived,
  };
}

function toUltimoEstado(device: DeviceRow, values: LastValue[]) {
  return {
    dispositivo_id: device.id,
    slug: device.slug,
    estado: device.status,
    ultimo_contato_em: device.last_contact_at ? device.last_contact_at.toISOString() : null,
    grandezas: values.map(toUltimoValor),
  };
}

// RF-DAD-02: último estado sem consultar a série (Redis e o espelho last_values).
@Controller()
@UseGuards(TenantGuard)
export class LastValuesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LastValuesConsumer) private readonly lastValues: LastValuesConsumer,
  ) {}

  @Get('dispositivos/:id/ultimo-estado')
  async device(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: requireUuid(id, 'dispositivo'), tenantId: tenant.id },
      select: { id: true, slug: true, status: true, lastContactAt: true },
    });
    if (!device) throw notFound('dispositivo');
    const values = await this.lastValues.store.read(tenant.id, device.id);
    return toUltimoEstado(
      {
        id: device.id,
        slug: device.slug,
        status: device.status,
        last_contact_at: device.lastContactAt,
      },
      values,
    );
  }

  @Get('ultimo-estado')
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, SORTABLE, 'slug');
    const filter = (name: string) => {
      const value = query[name];
      if (value === undefined || value === '') return null;
      if (typeof value !== 'string' || !UUID.test(value)) {
        throw badRequest([
          { path: name, rule: 'consulta', message: `${name} precisa ser um UUID` },
        ]);
      }
      return value;
    };
    const [site, area, domain] = [filter('site'), filter('area'), filter('dominio')];
    const status = query.estado === undefined || query.estado === '' ? null : String(query.estado);
    if (status !== null && !STATUSES.has(status)) {
      throw badRequest([
        { path: 'estado', rule: 'consulta', message: `estado desconhecido: ${status}` },
      ]);
    }
    const direction = q.sort.direction === 'desc' ? 'DESC' : 'ASC';
    const rows = await this.prisma.$queryRawUnsafe<(DeviceRow & { total: bigint })[]>(
      `SELECT d.id::text AS id, d.slug, d.status::text AS status, d.last_contact_at, count(*) OVER () AS total
         FROM devices d
         LEFT JOIN areas a ON a.id = $4::uuid AND a.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1::uuid
          AND ($2::uuid IS NULL OR d.site_id = $2::uuid)
          AND ($3::uuid IS NULL OR d.domain_id = $3::uuid)
          AND ($4::uuid IS NULL OR (d.location IS NOT NULL AND ST_Covers(a.geometry, d.location)))
          AND ($5::text IS NULL OR d.status::text = $5)
        ORDER BY d.${q.sort.field} ${direction} NULLS LAST, d.id
        LIMIT $6 OFFSET $7`,
      tenant.id,
      site,
      domain,
      area,
      status,
      q.limit,
      q.offset,
    );
    const values = await this.lastValues.store.readMany(
      tenant.id,
      rows.map((row) => row.id),
    );
    return page(
      rows.map((row) => toUltimoEstado(row, values.get(row.id) ?? [])),
      Number(rows[0]?.total ?? 0),
      q,
    );
  }
}
