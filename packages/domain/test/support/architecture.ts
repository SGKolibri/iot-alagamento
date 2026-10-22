import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Módulos que o núcleo de domínio não pode usar (CLAUDE.md, regra 2).
// "@escopo/*" bloqueia o escopo inteiro; os demais bloqueiam o pacote e seus subcaminhos.
export const FORBIDDEN_MODULES = [
  '@nestjs/*',
  '@prisma/*',
  'prisma',
  'ioredis',
  'redis',
  'mqtt',
  'sqlite3',
  'better-sqlite3',
  'better-sqlite3-multiple-ciphers',
  'next',
  'react',
  'react-dom',
  'pg',
  'express',
];

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function isForbiddenModule(specifier: string): boolean {
  return FORBIDDEN_MODULES.some((rule) =>
    rule.endsWith('/*')
      ? specifier.startsWith(rule.slice(0, -1))
      : specifier === rule || specifier.startsWith(`${rule}/`),
  );
}

export function findForbiddenImports(source: string): string[] {
  const hits: { index: number; specifier: string }[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      if (isForbiddenModule(specifier)) hits.push({ index: match.index, specifier });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.specifier);
}

type Manifest = Partial<
  Record<'dependencies' | 'peerDependencies' | 'optionalDependencies', Record<string, string>>
>;

// Só dependências que vão para a execução; devDependencies (Jest, ts-jest) não entram no pacote.
export function findForbiddenDependencies(manifest: Manifest): string[] {
  const runtime = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies];
  return runtime.flatMap((deps) => Object.keys(deps ?? {})).filter(isForbiddenModule);
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

// Casa o termo como palavra inteira; "_" e "-" contam como separadores (silo_id, talhao-07).
export function findScenarioTerms(source: string, terms: string[]): string[] {
  const folded = fold(source);
  return terms.filter((term) => new RegExp(`(?<![a-z0-9])${fold(term)}(?![a-z0-9])`).test(folded));
}

export function loadScenarioTerms(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { termos?: unknown };
  if (!Array.isArray(parsed.termos)) throw new Error(`Lista de termos inválida em ${path}`);
  return parsed.termos.map(String);
}

// Falha se a pasta não existir, para um caminho errado não passar em silêncio.
export function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`Pasta não encontrada: ${dir}`);
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx|js|mjs|cjs|json)$/.test(entry) ? [path] : [];
  });
}
