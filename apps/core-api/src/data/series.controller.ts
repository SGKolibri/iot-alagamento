import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { parseBucket, resolveRange, tooManyPoints, type ClockPort } from '@iot/domain';
import type { Pool } from 'pg';
import type { PrismaClient } from '../generated/prisma/client';
import { badRequest, notFound, requireUuid } from '../catalog/http-errors';
import { CLOCK, PG_POOL, PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { SeriesReader, type BucketPoint, type RawPoint } from './series.reader';

interface SeriesQuery {
  grandeza?: string;
  de?: string;
  ate?: string;
  bucket?: string;
}

function strip(point: RawPoint | BucketPoint) {
  const { deviceId: _deviceId, ...rest } = point;
  return rest;
}

// RF-DAD-01: série por dispositivo e por área, bruta ou agregada por bucket (time_bucket).
@Controller()
@UseGuards(TenantGuard)
export class SeriesController {
  private readonly reader: SeriesReader;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {
    this.reader = new SeriesReader(pool);
  }

  @Get('dispositivos/:id/telemetria')
  async device(
    @CurrentTenant() tenant: TenantRef,
    @Param('id') id: string,
    @Query() query: SeriesQuery,
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: requireUuid(id, 'dispositivo'), tenantId: tenant.id },
      select: { id: true },
    });
    if (!device) throw notFound('dispositivo');
    const { from, to, bucket, points } = await this.series(tenant, [device.id], query);
    return {
      dispositivo_id: device.id,
      de: from.toISOString(),
      ate: to.toISOString(),
      bucket,
      pontos: points.map(strip),
    };
  }

  @Get('telemetria')
  async area(@CurrentTenant() tenant: TenantRef, @Query() query: SeriesQuery & { area?: string }) {
    if (!query.area)
      throw badRequest([{ path: 'area', rule: 'consulta', message: 'informe a área (area)' }]);
    const area = await this.prisma.area.findFirst({
      where: { id: requireUuid(query.area, 'área'), tenantId: tenant.id },
      select: { id: true },
    });
    if (!area) throw notFound('área');
    const devices = await this.prisma.$queryRaw<{ id: string; slug: string }[]>`
      SELECT d.id::text AS id, d.slug FROM devices d JOIN areas a ON a.id = ${area.id}::uuid
       WHERE d.tenant_id = ${tenant.id}::uuid AND a.tenant_id = d.tenant_id
         AND d.location IS NOT NULL AND ST_Covers(a.geometry, d.location)
       ORDER BY d.slug`;
    const { from, to, bucket, points } = await this.series(
      tenant,
      devices.map((d) => d.id),
      query,
    );
    return {
      area_id: area.id,
      de: from.toISOString(),
      ate: to.toISOString(),
      bucket,
      series: devices.map((d) => ({
        dispositivo_id: d.id,
        slug: d.slug,
        pontos: points.filter((p) => p.deviceId === d.id).map(strip),
      })),
    };
  }

  private async series(tenant: TenantRef, deviceIds: string[], query: SeriesQuery) {
    const bucket = parseBucket(query.bucket);
    if ('issue' in bucket) throw badRequest([bucket.issue], 'parâmetros da série inválidos');
    const range = resolveRange(query.de, query.ate, this.clock.now());
    if ('issue' in range) throw badRequest([range.issue], 'parâmetros da série inválidos');
    const result = await this.reader.read({
      tenantId: tenant.id,
      deviceIds,
      quantity: query.grandeza || undefined,
      from: range.from,
      to: range.to,
      bucket: bucket.bucket,
    });
    if (result.exceeded) {
      const issue = tooManyPoints(result.points.length)!;
      throw new HttpException(
        { codigo: 'pontos_demais', mensagem: issue.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { from: range.from, to: range.to, bucket: bucket.bucket, points: result.points };
  }
}
