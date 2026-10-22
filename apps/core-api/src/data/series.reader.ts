import { MAX_SERIES_POINTS, type Bucket } from '@iot/domain';
import type { Pool } from 'pg';

export interface SeriesRequest {
  tenantId: string;
  deviceIds: string[];
  quantity?: string;
  from: Date;
  to: Date;
  bucket: Bucket | null;
}

export interface RawPoint {
  deviceId: string;
  grandeza: string;
  timestamp: string;
  valor: number;
  unidade: string;
  suspeita: boolean;
  atrasada: boolean;
  derivada: boolean;
}

export interface BucketPoint {
  deviceId: string;
  grandeza: string;
  inicio: string;
  media: number;
  minimo: number;
  maximo: number;
  quantidade: number;
}

const INTERVALS: Record<Bucket, string> = { '1m': '1 minute', '15m': '15 minutes', '1h': '1 hour' };

// RF-DAD-01: leitura da hipertabela pelo horário da medição (atrasadas ficam na posição certa).
// Lê até MAX_SERIES_POINTS + 1 linhas: a linha a mais indica que a consulta passou do limite.
export class SeriesReader {
  constructor(private readonly pool: Pool) {}

  async read(
    request: SeriesRequest,
  ): Promise<{ points: (RawPoint | BucketPoint)[]; exceeded: boolean }> {
    const params = [
      request.tenantId,
      request.deviceIds,
      request.quantity ?? null,
      request.from,
      request.to,
      MAX_SERIES_POINTS + 1,
    ];
    const where = `tenant_id = $1 AND device_id = ANY($2::uuid[]) AND ($3::text IS NULL OR quantity = $3)
                   AND ts >= $4 AND ts <= $5`;
    if (request.bucket === null) {
      const { rows } = await this.pool.query<{
        device_id: string;
        quantity: string;
        ts: Date;
        value: number;
        unit: string;
        suspect: boolean;
        late: boolean;
        derived: boolean;
      }>(
        `SELECT device_id, quantity, ts, value, unit, suspect, late, derived
           FROM measurements WHERE ${where}
          ORDER BY device_id, ts, quantity LIMIT $6`,
        params,
      );
      return {
        exceeded: rows.length > MAX_SERIES_POINTS,
        points: rows.map((r) => ({
          deviceId: r.device_id,
          grandeza: r.quantity,
          timestamp: r.ts.toISOString(),
          valor: r.value,
          unidade: r.unit,
          suspeita: r.suspect,
          atrasada: r.late,
          derivada: r.derived,
        })),
      };
    }
    const { rows } = await this.pool.query<{
      device_id: string;
      quantity: string;
      inicio: Date;
      media: number;
      minimo: number;
      maximo: number;
      quantidade: string;
    }>(
      `SELECT device_id, quantity, time_bucket($7::interval, ts) AS inicio,
              avg(value) AS media, min(value) AS minimo, max(value) AS maximo, count(*) AS quantidade
         FROM measurements WHERE ${where}
        GROUP BY device_id, quantity, inicio
        ORDER BY device_id, inicio, quantity LIMIT $6`,
      [...params, INTERVALS[request.bucket]],
    );
    return {
      exceeded: rows.length > MAX_SERIES_POINTS,
      points: rows.map((r) => ({
        deviceId: r.device_id,
        grandeza: r.quantity,
        inicio: r.inicio.toISOString(),
        media: r.media,
        minimo: r.minimo,
        maximo: r.maximo,
        quantidade: Number(r.quantidade),
      })),
    };
  }
}
