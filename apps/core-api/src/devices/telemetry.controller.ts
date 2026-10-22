import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type { Pool } from 'pg';
import type { PrismaClient } from '../generated/prisma/client';
import { notFound, requireUuid } from '../catalog/http-errors';
import { TimescaleSeriesReader } from '../ingestion/adapters/timescale-measurements';
import { PG_POOL, PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';

const LIMIT = 1000;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Leitura mínima da série (portão G1). O dispositivo precisa existir no inquilino do contexto:
// inexistente responde 404; existente sem medição, lista vazia. A T1c substitui esta rota.
@Controller('dispositivos')
@UseGuards(TenantGuard)
export class TelemetryController {
  private readonly reader: TimescaleSeriesReader;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {
    this.reader = new TimescaleSeriesReader(pool);
  }

  @Get(':id/telemetria')
  async read(
    @CurrentTenant() tenant: TenantRef,
    @Param('id') id: string,
    @Query('grandeza') quantity?: string,
    @Query('de') from?: string,
    @Query('ate') to?: string,
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: requireUuid(id, 'dispositivo'), tenantId: tenant.id },
      select: { id: true },
    });
    if (!device) throw notFound('dispositivo');
    const rows = await this.reader.read({
      tenantId: tenant.id,
      deviceId: device.id,
      quantity: quantity || undefined,
      from: parseDate(from),
      to: parseDate(to),
      limit: LIMIT,
    });
    const itens = rows.map((row) => ({
      grandeza: row.quantity,
      valor: row.value,
      unidade: row.unit,
      timestamp: row.ts.toISOString(),
      suspeita: row.suspect,
      atrasada: row.late,
      derivada: row.derived,
      id_mensagem: row.message_id,
      recebido_em: row.received_at.toISOString(),
    }));
    return { itens, pagina: 1, limite: LIMIT, total: itens.length };
  }
}
