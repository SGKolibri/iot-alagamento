import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@readme/openapi-parser';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { Example } from './examples';
import { CONTRACTS_DIR, EXAMPLES_DIR, SCHEMA_FILES } from './paths';
import type { ValidationIssue, ValidationResult } from './schema-validator';

export interface ResponseValidator {
  validate(schemaName: string, data: unknown): ValidationResult;
}

export interface ExpectedResponseError {
  esquema: string;
  caminho: string;
  regra: string;
  motivo: string;
  campo_ausente?: string;
}

const OPENAPI_ID = 'openapi.json';

// Valida dados contra um esquema de components.schemas do openapi.yaml (OpenAPI 3.1 usa
// JSON Schema 2020-12). Os $ref externos resolvem pelos schemas canônicos registrados.
export async function createResponseValidator(
  contractsDir: string = CONTRACTS_DIR,
): Promise<ResponseValidator> {
  const doc = (await parse(join(contractsDir, 'openapi.yaml'))) as {
    components?: { schemas?: Record<string, unknown> };
  };
  // strict desligado: o documento traz extensões x-* e chaves do OpenAPI fora do JSON Schema.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of Object.values(SCHEMA_FILES)) {
    ajv.addSchema(JSON.parse(readFileSync(join(contractsDir, file), 'utf8')) as object, file);
  }
  ajv.addSchema({ components: doc.components }, OPENAPI_ID);

  return {
    validate(schemaName, data) {
      if (!doc.components?.schemas?.[schemaName]) {
        throw new Error(`Esquema inexistente no OpenAPI: ${schemaName}`);
      }
      const validate = ajv.getSchema(`${OPENAPI_ID}#/components/schemas/${schemaName}`)!;
      const valid = validate(data) as boolean;
      const errors: ValidationIssue[] = valid
        ? []
        : (validate.errors ?? []).map((e) => ({
            path: e.instancePath,
            keyword: e.keyword,
            message: e.message ?? e.keyword,
            params: e.params as Record<string, unknown>,
          }));
      return { valid, errors };
    },
  };
}

const PREFIXES: Record<string, string> = {
  'resultado-lote-': 'ResultadoLote',
  'resultado-mensagem-': 'ResultadoMensagem',
};

export function responseSchemaForExample(file: string): string {
  const prefix = Object.keys(PREFIXES).find((p) => file.startsWith(p));
  if (!prefix) throw new Error(`Sem esquema de resposta para o exemplo ${file}`);
  return PREFIXES[prefix]!;
}

export function listResponseExamples(
  kind: 'valid' | 'invalid',
  examplesDir: string = EXAMPLES_DIR,
): Example[] {
  const dir = join(examplesDir, 'responses', kind);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown }));
}

export function loadExpectedResponseErrors(
  examplesDir: string = EXAMPLES_DIR,
): Record<string, ExpectedResponseError> {
  const file = join(examplesDir, 'responses', 'expected-errors.json');
  return (
    JSON.parse(readFileSync(file, 'utf8')) as { exemplos: Record<string, ExpectedResponseError> }
  ).exemplos;
}
