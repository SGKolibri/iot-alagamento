import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FORBIDDEN_MODULES,
  findForbiddenDependencies,
  findForbiddenImports,
  findScenarioTerms,
  listSourceFiles,
  loadScenarioTerms,
} from './support/architecture';

const repoRoot = resolve(__dirname, '../../..');
const domainRoot = resolve(__dirname, '..');

describe('verificador de arquitetura', () => {
  it('detecta import, require e import dinâmico de framework', () => {
    const source = [
      "import { Injectable } from '@nestjs/common';",
      "const Redis = require('ioredis');",
      "const mqtt = await import('mqtt');",
      "import type { PrismaClient } from '@prisma/client';",
      "export * from 'next/server';",
    ].join('\n');

    expect(findForbiddenImports(source)).toEqual([
      '@nestjs/common',
      'ioredis',
      'mqtt',
      '@prisma/client',
      'next/server',
    ]);
  });

  it('aceita imports relativos e da biblioteca padrão do Node', () => {
    const source = "import { x } from './x';\nimport { randomUUID } from 'node:crypto';";
    expect(findForbiddenImports(source)).toEqual([]);
  });

  it('não confunde pacotes com nome parecido', () => {
    expect(findForbiddenImports("import x from 'nextjs-helper';")).toEqual([]);
    expect(findForbiddenImports("import x from 'redis-like';")).toEqual([]);
  });

  it('detecta framework nas dependências do package.json', () => {
    const manifest = {
      dependencies: { '@nestjs/core': '11.0.0', lodash: '4.0.0' },
      peerDependencies: { pg: '8.0.0' },
      devDependencies: { jest: '30.0.0' },
    };
    expect(findForbiddenDependencies(manifest)).toEqual(['@nestjs/core', 'pg']);
  });

  it('detecta termos de cenário com e sem acento, ignorando maiúsculas', () => {
    const terms = ['alagamento', 'córrego', 'talhão'];
    const source = 'const a = "Alagamento";\n// corrego do centro\nconst t = "TALHAO-07";';
    expect(findScenarioTerms(source, terms)).toEqual(['alagamento', 'córrego', 'talhão']);
  });

  it('só casa termos como palavra inteira', () => {
    expect(findScenarioTerms('const silos2 = 1; const consilo = 2;', ['silo'])).toEqual([]);
    expect(findScenarioTerms('const silo_id = 1;', ['silo'])).toEqual(['silo']);
  });
});

describe('pacote domain', () => {
  it('não declara framework como dependência', () => {
    const manifest = JSON.parse(readFileSync(join(domainRoot, 'package.json'), 'utf8'));
    expect(findForbiddenDependencies(manifest)).toEqual([]);
  });

  it('não importa nenhum framework', () => {
    const violations = scanFiles(join(domainRoot, 'src'), findForbiddenImports);
    expect(violations).toEqual([]);
  });

  it('cobre a lista mínima de módulos proibidos', () => {
    expect(FORBIDDEN_MODULES).toEqual(
      expect.arrayContaining(['@nestjs/*', '@prisma/*', 'ioredis', 'redis', 'mqtt', 'next']),
    );
  });
});

describe('núcleo neutro (RNF-08)', () => {
  const terms = loadScenarioTerms(join(repoRoot, 'config/neutrality/scenario-terms.json'));

  it('a lista de termos de cenário existe e não está vazia', () => {
    expect(terms).toEqual(
      expect.arrayContaining(['alagamento', 'córrego', 'talhão', 'silo', 'fazenda']),
    );
  });

  it.each(['packages/domain/src', 'apps/core-api/src'])('%s não contém termo de cenário', (dir) => {
    const violations = scanFiles(join(repoRoot, dir), (source) => findScenarioTerms(source, terms));
    expect(violations).toEqual([]);
  });
});

function scanFiles(dir: string, check: (source: string) => string[]): string[] {
  return listSourceFiles(dir).flatMap((file) =>
    check(readFileSync(file, 'utf8')).map((hit) => `${file}: ${hit}`),
  );
}
