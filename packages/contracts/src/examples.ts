import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLES_DIR, type ContractName } from './paths';

export interface Example {
  file: string;
  data: unknown;
}

export interface ExpectedError {
  contrato: ContractName;
  caminho: string;
  regra: string;
  motivo: string;
  campo_ausente?: string;
  campo_extra?: string;
}

export function listExamples(kind: 'valid' | 'invalid', examplesDir = EXAMPLES_DIR): Example[] {
  const dir = join(examplesDir, kind);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown }));
}

export function loadExpectedErrors(examplesDir = EXAMPLES_DIR): Record<string, ExpectedError> {
  const file = join(examplesDir, 'expected-errors.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { exemplos: Record<string, ExpectedError> })
    .exemplos;
}

// Exemplos de lote começam com "lote-", de regra com "regra-"; os demais são mensagens.
export function contractForExample(file: string): ContractName {
  if (file.startsWith('lote-')) return 'lote';
  if (file.startsWith('regra-')) return 'regra';
  return 'mensagem';
}
