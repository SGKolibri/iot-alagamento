import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import type { Pool } from 'pg';
import { TimescaleSeriesReader } from '../adapters/timescale-measurements';
import { PG_POOL } from '../tokens';
import { error } from './responses';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 1000;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Leitura mínima da série, só para provar o portão G1 (a T1c substitui).
@Controller('dispositivos')
export class TelemetryController {
  private readonly reader: TimescaleSeriesReader;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.reader = new TimescaleSeriesReader(pool);
  }

  @Get(':id/telemetria')
  async read(
    @Param('id') id: string,
    @Query('grandeza') quantity?: string,
    @Query('de') from?: string,
    @Query('ate') to?: string,
  ) {
    const notFound = () =>
      new NotFoundException(error('nao_encontrado', 'dispositivo sem medições ou inexistente'));
    if (!UUID.test(id)) throw notFound();
    const rows = await this.reader.read({
      deviceId: id,
      quantity: quantity || undefined,
      from: parseDate(from),
      to: parseDate(to),
      limit: LIMIT,
    });
    if (rows.length === 0 && !quantity && !from && !to) throw notFound();
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
