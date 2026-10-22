import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

// Aplica os arquivos de migrations/sql em ordem, cada um numa transação, e registra os
// aplicados em schema_migrations. Devolve os nomes aplicados nesta chamada.
export async function applyMigrations(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  const files = readdirSync(dir)
    .filter((file) => FILE_PATTERN.test(file))
    .sort();

  const done: string[] = [];
  for (const file of files.filter((f) => !applied.has(f))) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      done.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migração ${file} falhou: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }
  return done;
}
