// pnpm seed:load-series: massa de dados para os testes de desempenho da série (T1c, RF-DAD-01).
// 200 dispositivos, 30 dias até agora e 1 leitura por minuto da grandeza "temperatura": cerca de
// 8,6 milhões de linhas. Os pontos são gerados dentro do PostgreSQL (generate_series), sem
// trafegar as linhas pelo cliente. 10 dispositivos ficam dentro da área "area-carga".
// Rodar de novo apaga e recria o inquilino de carga.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { findRepoRoot, loadIngestionConfig } from '../ingestion/infra/config';
import { applyMigrations } from '../ingestion/infra/sql-migrations';

export const LOAD_TENANT = 'carga-series';
const DEVICES = 200;
const INSIDE_AREA = 10;
const DAYS = 30;

async function main(): Promise<void> {
  const root = findRepoRoot();
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const pool = new Pool(loadIngestionConfig().postgres);
  const started = Date.now();
  try {
    await applyMigrations(pool, join(root, 'migrations/sql'));
    const existing = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
      LOAD_TENANT,
    ]);
    if (existing.rows[0]) {
      const id = existing.rows[0].id;
      for (const table of [
        'measurements',
        'last_values',
        'devices',
        'areas',
        'sites',
        'device_profiles',
        'domains',
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]);
      }
      await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
    }
    const tenantId = randomUUID();
    const domainId = randomUUID();
    const profileId = randomUUID();
    const siteId = randomUUID();
    const areaId = randomUUID();
    await pool.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $2)', [
      tenantId,
      LOAD_TENANT,
    ]);
    await pool.query(
      "INSERT INTO domains (id, tenant_id, slug, name, updated_at) VALUES ($1, $2, 'carga', 'Carga', now())",
      [domainId, tenantId],
    );
    await pool.query(
      `INSERT INTO device_profiles (id, tenant_id, domain_id, name, expected_interval_s, quantities, updated_at)
       VALUES ($1, $2, $3, 'termômetro de carga', 60, '[{"nome":"temperatura","unidade":"Cel"}]', now())`,
      [profileId, tenantId, domainId],
    );
    await pool.query(
      "INSERT INTO sites (id, tenant_id, slug, name, updated_at) VALUES ($1, $2, 'site-carga', 'Site de carga', now())",
      [siteId, tenantId],
    );
    await pool.query(
      `INSERT INTO areas (id, tenant_id, site_id, slug, name, geometry, updated_at)
       VALUES ($1, $2, $3, 'area-carga', 'Área de carga',
               ST_SetSRID(ST_GeomFromText('POLYGON((-48 -16, -47 -16, -47 -15, -48 -15, -48 -16))'), 4326), now())`,
      [areaId, tenantId, siteId],
    );
    const deviceIds: string[] = [];
    for (let i = 0; i < DEVICES; i++) {
      const id = randomUUID();
      deviceIds.push(id);
      // Os 10 primeiros dentro do polígono da área; os demais fora.
      const [lon, lat] =
        i < INSIDE_AREA
          ? [-47.9 + i * 0.05, -15.5]
          : [-46 + (i % 50) * 0.01, -14 - Math.floor(i / 50) * 0.01];
      await pool.query(
        `INSERT INTO devices (id, tenant_id, slug, domain_id, profile_id, profile_version, site_id,
                              credential_id, credential_hash, credential_salt, location, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'sem-uso', 'sem-uso', ST_SetSRID(ST_MakePoint($8, $9), 4326), now())`,
        [
          id,
          tenantId,
          `carga-${String(i).padStart(3, '0')}`,
          domainId,
          profileId,
          siteId,
          randomBytes(16).toString('base64url'),
          lon,
          lat,
        ],
      );
    }
    const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    for (const [index, deviceId] of deviceIds.entries()) {
      await pool.query(
        `INSERT INTO measurements (tenant_id, device_id, quantity, ts, value, unit, message_id, received_at)
         SELECT $1, $2, 'temperatura', ts, 20 + 5 * sin(extract(epoch FROM ts) / 3600) + random(), 'Cel',
                gen_random_uuid(), ts
           FROM generate_series($3::timestamptz - interval '${DAYS} days', $3::timestamptz - interval '1 minute',
                                interval '1 minute') AS ts`,
        [tenantId, deviceId, end],
      );
      if ((index + 1) % 20 === 0) process.stdout.write(`  ${index + 1}/${DEVICES} dispositivos\n`);
    }
    await pool.query('ANALYZE measurements');
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM measurements WHERE tenant_id = $1',
      [tenantId],
    );
    console.log(
      `Massa de carga pronta: ${rows[0]!.n} medições, ${DEVICES} dispositivos (${INSIDE_AREA} na área), ` +
        `${DAYS} dias até ${end.toISOString()}, em ${Math.round((Date.now() - started) / 1000)} s.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
