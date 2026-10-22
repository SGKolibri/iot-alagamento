import { join } from 'node:path';
import {
  contractForExample,
  listExamples,
  loadExpectedErrors,
  type ExpectedError,
} from './examples';
import { CONTRACTS_DIR, EXAMPLES_DIR } from './paths';
import {
  createResponseValidator,
  listResponseExamples,
  loadExpectedResponseErrors,
  responseSchemaForExample,
} from './response-validator';
import { createSchemaValidator, type ValidationIssue } from './schema-validator';
import { validateAsyncApi, validateOpenApi } from './specs';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function formatIssues(errors: ValidationIssue[]): string {
  return errors.map((e) => `${e.path || '(raiz)'} ${e.keyword}: ${e.message}`).join('; ');
}

function matchesExpected(errors: ValidationIssue[], rule: ExpectedError): boolean {
  return errors.some(
    (e) =>
      e.path === rule.caminho &&
      e.keyword === rule.regra &&
      (!rule.campo_ausente || e.params.missingProperty === rule.campo_ausente) &&
      (!rule.campo_extra || e.params.additionalProperty === rule.campo_extra),
  );
}

export function checkExamples(
  options: { contractsDir?: string; examplesDir?: string } = {},
): CheckResult[] {
  const examplesDir = options.examplesDir ?? EXAMPLES_DIR;
  const validator = createSchemaValidator(options.contractsDir ?? CONTRACTS_DIR);
  const expected = loadExpectedErrors(examplesDir);

  const invalid = listExamples('invalid', examplesDir).map(({ file, data }): CheckResult => {
    const name = `invalid/${file}`;
    const rule = expected[file];
    if (!rule) return { name, ok: false, detail: 'sem erro esperado em expected-errors.json' };
    const result = validator.validate(rule.contrato, data);
    if (result.valid) return { name, ok: false, detail: 'foi aceito, mas deveria ser rejeitado' };
    if (!matchesExpected(result.errors, rule)) {
      return {
        name,
        ok: false,
        detail: `rejeitado por outro motivo; esperado ${rule.caminho || '(raiz)'} ${rule.regra}, obtido ${formatIssues(result.errors)}`,
      };
    }
    return { name, ok: true, detail: rule.motivo };
  });

  const valid = listExamples('valid', examplesDir).map(({ file, data }): CheckResult => {
    const result = validator.validate(contractForExample(file), data);
    return result.valid
      ? { name: `valid/${file}`, ok: true }
      : { name: `valid/${file}`, ok: false, detail: formatIssues(result.errors) };
  });

  return [...invalid, ...valid];
}

export async function checkContracts(contractsDir: string = CONTRACTS_DIR): Promise<CheckResult[]> {
  const examples = checkExamples({ contractsDir, examplesDir: join(contractsDir, 'examples') });
  const responses = await checkResponseExamples(contractsDir);
  const asyncApi = await validateAsyncApi(join(contractsDir, 'asyncapi.yaml'));
  const openApi = await validateOpenApi(join(contractsDir, 'openapi.yaml'));
  return [
    ...examples,
    ...responses,
    { name: 'asyncapi.yaml', ok: asyncApi.valid, detail: asyncApi.errors.join('; ') || undefined },
    { name: 'openapi.yaml', ok: openApi.valid, detail: openApi.errors.join('; ') || undefined },
  ];
}

// Exemplos de resposta (docs/contracts/examples/responses) contra os esquemas do OpenAPI.
export async function checkResponseExamples(
  contractsDir: string = CONTRACTS_DIR,
): Promise<CheckResult[]> {
  const examplesDir = join(contractsDir, 'examples');
  const validator = await createResponseValidator(contractsDir);
  const expected = loadExpectedResponseErrors(examplesDir);
  const valid = listResponseExamples('valid', examplesDir).map(({ file, data }): CheckResult => {
    const result = validator.validate(responseSchemaForExample(file), data);
    return {
      name: `responses/valid/${file}`,
      ok: result.valid,
      detail: result.valid ? undefined : formatIssues(result.errors),
    };
  });
  const invalid = listResponseExamples('invalid', examplesDir).map(
    ({ file, data }): CheckResult => {
      const name = `responses/invalid/${file}`;
      const rule = expected[file];
      if (!rule) return { name, ok: false, detail: 'sem erro esperado em expected-errors.json' };
      const result = validator.validate(rule.esquema, data);
      if (result.valid) return { name, ok: false, detail: 'foi aceito, mas deveria ser rejeitado' };
      const matched = result.errors.some(
        (e) =>
          e.path === rule.caminho &&
          e.keyword === rule.regra &&
          (!rule.campo_ausente || e.params.missingProperty === rule.campo_ausente),
      );
      return matched
        ? { name, ok: true, detail: rule.motivo }
        : { name, ok: false, detail: `rejeitado por outro motivo: ${formatIssues(result.errors)}` };
    },
  );
  return [...valid, ...invalid];
}
