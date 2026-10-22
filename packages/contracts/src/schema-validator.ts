import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { CONTRACTS_DIR, SCHEMA_FILES, type ContractName } from './paths';

export interface ValidationIssue {
  path: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

export interface SchemaValidator {
  validate(contract: ContractName, data: unknown): ValidationResult;
}

function toIssue(error: ErrorObject): ValidationIssue {
  return {
    path: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? error.keyword,
    params: error.params as Record<string, unknown>,
  };
}

export function createSchemaValidator(contractsDir: string = CONTRACTS_DIR): SchemaValidator {
  // strict: palavra-chave desconhecida no schema é erro de compilação, não passa em silêncio.
  // strictRequired fica desligado porque acusa os "required" dentro de if/then, cujos campos
  // estão definidos no schema pai; strictTuples, porque a posição GeoJSON tem altitude opcional.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTuples: false,
  });
  addFormats(ajv);

  // Cada schema é registrado pelo nome do arquivo; assim o $ref relativo do lote
  // ("canonical-message.v1.schema.json") resolve igual no Ajv e nos parsers de AsyncAPI e OpenAPI.
  for (const file of Object.values(SCHEMA_FILES)) {
    ajv.addSchema(JSON.parse(readFileSync(join(contractsDir, file), 'utf8')) as object, file);
  }

  const compiled = new Map<ContractName, ValidateFunction>();
  for (const [name, file] of Object.entries(SCHEMA_FILES) as [ContractName, string][]) {
    const validate = ajv.getSchema(file);
    if (!validate) throw new Error(`Schema não compilado: ${file}`);
    compiled.set(name, validate);
  }

  return {
    validate(contract, data) {
      const validate = compiled.get(contract)!;
      const valid = validate(data) as boolean;
      return { valid, errors: valid ? [] : (validate.errors ?? []).map(toIssue) };
    },
  };
}
