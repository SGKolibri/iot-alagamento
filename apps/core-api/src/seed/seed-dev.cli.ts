// pnpm seed:dev: aplica um pacote de cenário (config/scenarios/dev-seed.json, ou SEED_FILE) pela
// API e grava a credencial do dispositivo em SIM_DEVICE_TOKEN no .env, de onde o basic-publisher a
// lê. Pode rodar mais de uma vez: o que já existe é reaproveitado, e a credencial é trocada.
// O núcleo não conhece o cenário: os dados vêm todos do arquivo (CLAUDE.md, regra 3).
import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { issueCredential } from '../devices/credentials';
import { findRepoRoot, loadIngestionConfig } from '../ingestion/infra/config';
import { applyMigrations } from '../ingestion/infra/sql-migrations';

interface SeedFile {
  inquilino: { slug: string; nome: string };
  dominio: { slug: string; nome: string };
  perfil: { nome: string; intervalo_esperado_s: number; grandezas: object[] };
  site: { slug: string; nome: string; geometria?: object };
  area: { slug: string; nome: string; geometria: object };
  dispositivo: { slug: string; atributos?: Record<string, number>; localizacao?: object };
}

function writeEnv(file: string, key: string, value: string): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else
    lines.splice(
      lines.length && lines.at(-1) === '' ? lines.length - 1 : lines.length,
      0,
      `${key}=${value}`,
    );
  writeFileSync(file, lines.join('\n'));
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  // O seed não assina MQTT nem roda as tarefas de fundo.
  delete process.env.MQTT_HOST;
  delete process.env.REDIS_HOST;
  process.env.LOG_LEVEL = 'warn';

  const seed = JSON.parse(
    readFileSync(process.env.SEED_FILE ?? join(root, 'config/scenarios/dev-seed.json'), 'utf8'),
  ) as SeedFile;
  const TENANT = seed.inquilino.slug;
  const pool = new Pool(loadIngestionConfig().postgres);
  await applyMigrations(pool, join(root, 'migrations/sql'));
  await pool.query(
    'INSERT INTO tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING',
    [TENANT, seed.inquilino.nome],
  );
  const idOf = async (sql: string, params: unknown[]) =>
    (await pool.query<{ id: string }>(sql, params)).rows[0]?.id;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const post = async (path: string, body: object): Promise<{ id: string; credencial?: string }> => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant': TENANT },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { id: string; credencial?: string };
    if (response.status !== 201)
      throw new Error(`${path} respondeu ${response.status}: ${JSON.stringify(json)}`);
    return json;
  };

  try {
    const tenantId = (await idOf('SELECT id FROM tenants WHERE slug = $1', [TENANT]))!;
    const domainId =
      (await idOf('SELECT id FROM domains WHERE tenant_id = $1 AND slug = $2', [
        tenantId,
        seed.dominio.slug,
      ])) ?? (await post('/catalogo/dominios', seed.dominio)).id;
    const profileId =
      (await idOf('SELECT id FROM device_profiles WHERE tenant_id = $1 AND name = $2', [
        tenantId,
        seed.perfil.nome,
      ])) ?? (await post('/perfis', { dominio_id: domainId, ...seed.perfil })).id;
    const siteId =
      (await idOf('SELECT id FROM sites WHERE tenant_id = $1 AND slug = $2', [
        tenantId,
        seed.site.slug,
      ])) ?? (await post('/sites', seed.site)).id;
    const areaId =
      (await idOf('SELECT id FROM areas WHERE tenant_id = $1 AND slug = $2', [
        tenantId,
        seed.area.slug,
      ])) ?? (await post('/areas', { site_id: siteId, ...seed.area })).id;

    let token: string;
    const deviceId = await idOf('SELECT id FROM devices WHERE tenant_id = $1 AND slug = $2', [
      tenantId,
      seed.dispositivo.slug,
    ]);
    if (deviceId) {
      // Dispositivo já existe: troca a credencial (o token antigo deixa de valer).
      const credential = await issueCredential();
      await pool.query(
        `UPDATE devices SET credential_id = $2, credential_hash = $3, credential_salt = $4,
                credential_revoked_at = NULL, updated_at = now() WHERE id = $1`,
        [deviceId, credential.id, credential.hash, credential.salt],
      );
      token = credential.token;
    } else {
      token = (
        await post('/dispositivos', {
          ...seed.dispositivo,
          perfil_id: profileId,
          site_id: siteId,
          area_id: areaId,
        })
      ).credencial!;
    }
    writeEnv(envFile, 'SIM_DEVICE_TOKEN', token);
    console.log(
      `Catálogo pronto: inquilino ${TENANT}, domínio ${seed.dominio.slug}, site ${seed.site.slug}, ` +
        `área ${seed.area.slug} e dispositivo ${seed.dispositivo.slug}. Credencial em SIM_DEVICE_TOKEN no .env.`,
    );
  } finally {
    await app.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
