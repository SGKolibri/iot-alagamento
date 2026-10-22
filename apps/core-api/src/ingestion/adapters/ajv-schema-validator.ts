import { createSchemaValidator, type SchemaValidator, type ValidationIssue } from '@iot/contracts';
import type { Issue, SchemaValidatorPort } from '@iot/domain';

// Versões do contrato aceitas e o schema de cada uma.
const MESSAGE_SCHEMAS: Record<string, 'mensagem'> = { '1.0': 'mensagem' };

function readable(issue: ValidationIssue): Issue {
  const p = issue.params;
  switch (issue.keyword) {
    case 'required':
      return {
        path: `${issue.path}/${String(p.missingProperty)}`,
        rule: 'required',
        message: `campo obrigatório ausente: ${String(p.missingProperty)}`,
      };
    case 'additionalProperties':
      return {
        path: `${issue.path}/${String(p.additionalProperty)}`,
        rule: 'additionalProperties',
        message: `campo fora do contrato: ${String(p.additionalProperty)}`,
      };
    default:
      return { path: issue.path, rule: issue.keyword, message: describe(issue) };
  }
}

function describe(issue: ValidationIssue): string {
  const p = issue.params;
  switch (issue.keyword) {
    case 'const':
      return `precisa ser igual a ${JSON.stringify(p.allowedValue)}`;
    case 'enum':
      return `valor fora da lista: ${(p.allowedValues as unknown[]).join(', ')}`;
    case 'type':
      return `precisa ser do tipo ${String(p.type)}`;
    case 'format':
      return `formato inválido: ${String(p.format)}`;
    case 'pattern':
      return issue.path.endsWith('/timestamp')
        ? 'formato inválido: o horário precisa estar em UTC, terminando em Z'
        : `formato inválido: precisa seguir ${String(p.pattern)}`;
    case 'minItems':
      return `precisa ter ao menos ${String(p.limit)} ${p.limit === 1 ? 'item' : 'itens'}`;
    case 'maxItems':
      return `pode ter no máximo ${String(p.limit)} itens`;
    case 'minLength':
      return p.limit === 1
        ? 'não pode ser vazio'
        : `precisa ter ao menos ${String(p.limit)} caracteres`;
    case 'minimum':
      return `precisa ser no mínimo ${String(p.limit)}`;
    case 'maximum':
      return `precisa ser no máximo ${String(p.limit)}`;
    default:
      return issue.message;
  }
}

function toIssues(issues: ValidationIssue[]): Issue[] {
  const seen = new Set<string>();
  return issues
    .filter((issue) => issue.keyword !== 'if')
    .map(readable)
    .filter((issue) => {
      const key = `${issue.path}|${issue.rule}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// SchemaValidatorPort com Ajv, sobre os schemas de docs/contracts (via @iot/contracts).
export class AjvSchemaValidator implements SchemaValidatorPort {
  constructor(private readonly validator: SchemaValidator = createSchemaValidator()) {}

  validateMessage(data: unknown): Issue[] {
    const version = (data as { versao?: unknown } | null)?.versao;
    if (typeof version === 'string' && !Object.hasOwn(MESSAGE_SCHEMAS, version)) {
      return [
        {
          path: '/versao',
          rule: 'versao',
          message: `versão desconhecida: ${version} (aceitas: ${Object.keys(MESSAGE_SCHEMAS).join(', ')})`,
        },
      ];
    }
    const schema = MESSAGE_SCHEMAS[typeof version === 'string' ? version : '1.0']!;
    return toIssues(this.validator.validate(schema, data).errors);
  }

  validateBatch(data: unknown): Issue[] {
    return toIssues(this.validator.validate('lote', data).errors);
  }
}
