// pnpm --filter @iot/core-api db:migrate: aplica migrations/sql no PostgreSQL do .env.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { findRepoRoot, loadIngestionConfig } from './config';
import { applyMigrations } from './sql-migrations';

async function main(): Promise<void> {
  const root = findRepoRoot();
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const pool = new Pool(loadIngestionConfig().postgres);
  try {
    const applied = await applyMigrations(pool, join(root, 'migrations/sql'));
    console.log(applied.length > 0 ? `Aplicadas: ${applied.join(', ')}` : 'Nada a aplicar.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
