import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const coreApi = resolve(__dirname, '../..');
const migration = join(coreApi, '../../migrations/sql/0002_catalog.sql');
const MARKER = '-- Gerado pelo Prisma a partir de apps/core-api/prisma/schema.prisma:';

// ADR-015: o SQL do catálogo versionado em migrations/sql é exatamente o que o Prisma gera
// do schema. Mudou o schema, regenere a migração (ou crie a próxima).
describe('migração do catálogo e schema do Prisma', () => {
  it('0002_catalog.sql corresponde ao schema.prisma', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'prisma-diff-')), 'catalog.sql');
    execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema',
        'prisma/schema.prisma',
        '--script',
        '-o',
        output,
      ],
      { cwd: coreApi, stdio: 'ignore' },
    );
    const generated = readFileSync(output, 'utf8');
    const versioned = readFileSync(migration, 'utf8');
    const body = versioned.slice(versioned.indexOf(MARKER) + MARKER.length).trim();
    expect(body).toBe(generated.trim());
  }, 60_000);
});
