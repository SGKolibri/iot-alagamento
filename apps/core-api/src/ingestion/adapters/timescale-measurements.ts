import type { Measurement, MeasurementRepositoryPort } from '@iot/domain';
import type { Pool } from 'pg';

const CHUNK = 5000;

// Gravação em lote na hipertabela, idempotente pela chave (device_id, quantity, ts).
export class TimescaleMeasurementRepository implements MeasurementRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveAll(measurements: Measurement[]): Promise<void> {
    for (let i = 0; i < measurements.length; i += CHUNK) {
      const rows = measurements.slice(i, i + CHUNK);
      await this.pool.query(
        `INSERT INTO measurements
           (tenant_id, device_id, quantity, ts, value, unit, suspect, late, derived, message_id, received_at)
         SELECT * FROM unnest(
           $1::uuid[], $2::uuid[], $3::text[], $4::timestamptz[], $5::float8[], $6::text[],
           $7::bool[], $8::bool[], $9::bool[], $10::uuid[], $11::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [
          rows.map((m) => m.tenantId),
          rows.map((m) => m.deviceId),
          rows.map((m) => m.quantity),
          rows.map((m) => m.timestamp),
          rows.map((m) => m.value),
          rows.map((m) => m.unit),
          rows.map((m) => m.suspect),
          rows.map((m) => m.late),
          rows.map((m) => m.derived),
          rows.map((m) => m.messageId),
          rows.map((m) => m.receivedAt),
        ],
      );
    }
  }
}

export interface SeriesQuery {
  deviceId: string;
  quantity?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface SeriesRow {
  quantity: string;
  ts: Date;
  value: number;
  unit: string;
  suspect: boolean;
  late: boolean;
  derived: boolean;
  message_id: string;
  received_at: Date;
}

// Leitura mínima da série para o portão G1; a T1c traz paginação padronizada e desempenho.
export class TimescaleSeriesReader {
  constructor(private readonly pool: Pool) {}

  async read(query: SeriesQuery): Promise<SeriesRow[]> {
    const { rows } = await this.pool.query<SeriesRow>(
      `SELECT quantity, ts, value, unit, suspect, late, derived, message_id, received_at
         FROM measurements
        WHERE device_id = $1
          AND ($2::text IS NULL OR quantity = $2)
          AND ($3::timestamptz IS NULL OR ts >= $3)
          AND ($4::timestamptz IS NULL OR ts <= $4)
        ORDER BY ts, quantity
        LIMIT $5`,
      [query.deviceId, query.quantity ?? null, query.from ?? null, query.to ?? null, query.limit],
    );
    return rows;
  }
}
