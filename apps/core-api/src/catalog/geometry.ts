import type { PrismaClient } from '../generated/prisma/client';

const TABLES = { sites: 'geometry', areas: 'geometry', devices: 'location' } as const;

// O Prisma não lê colunas geometry (Unsupported); elas vêm em GeoJSON por consulta crua.
export async function geometriesOf(
  prisma: PrismaClient,
  table: keyof typeof TABLES,
  ids: string[],
): Promise<Map<string, unknown>> {
  if (ids.length === 0) return new Map();
  const column = TABLES[table];
  const rows = await prisma.$queryRawUnsafe<{ id: string; geojson: unknown }[]>(
    `SELECT id::text AS id, ST_AsGeoJSON(${column})::json AS geojson FROM ${table} WHERE id = ANY($1::uuid[])`,
    ids,
  );
  return new Map(rows.map((row) => [row.id, row.geojson]));
}

export function geometrySql(geojson: unknown): string | null {
  return geojson === undefined || geojson === null ? null : JSON.stringify(geojson);
}
