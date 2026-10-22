import { compileExpression, ExpressionError } from '../ingestion/expression';
import type { Issue, QuantitySpec } from '../ingestion/model';

const ATTRIBUTE = 'atributos.';
const UCUM_CODE = /^\S+$/;

// RF-CEN-02: grandezas do perfil com unidade UCUM, faixa coerente e expressão derivada aceita
// pelo mesmo avaliador seguro da ingestão.
export function validateProfileQuantities(quantities: QuantitySpec[]): Issue[] {
  if (quantities.length === 0) {
    return [
      {
        path: '/grandezas',
        rule: 'minItems',
        message: 'o perfil precisa de ao menos uma grandeza',
      },
    ];
  }
  const names = new Set(quantities.map((q) => q.name));
  const seen = new Set<string>();
  const issues: Issue[] = [];

  quantities.forEach((quantity, index) => {
    const at = (field: string) => `/grandezas/${index}/${field}`;
    if (seen.has(quantity.name)) {
      issues.push({
        path: at('nome'),
        rule: 'unico',
        message: `grandeza repetida: ${quantity.name}`,
      });
    }
    seen.add(quantity.name);

    if (quantity.unit.length === 0) {
      issues.push({
        path: at('unidade'),
        rule: 'unidade',
        message: 'a unidade UCUM não pode ser vazia',
      });
    } else if (!UCUM_CODE.test(quantity.unit)) {
      issues.push({
        path: at('unidade'),
        rule: 'unidade',
        message: `a unidade UCUM não pode ter espaço: ${quantity.unit}`,
      });
    }

    const { min, max } = quantity.range ?? {};
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({
        path: at('faixa'),
        rule: 'faixa',
        message: `o mínimo (${min}) é maior que o máximo (${max})`,
      });
    }

    if (quantity.expression !== undefined) {
      issues.push(...validateExpression(quantity, names, at('expressao')));
    }
  });
  return issues;
}

function validateExpression(quantity: QuantitySpec, names: Set<string>, path: string): Issue[] {
  let references: string[];
  try {
    references = compileExpression(quantity.expression!).references;
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return [{ path, rule: 'expressao', message: `expressão inválida: ${error.message}` }];
  }
  return references
    .filter((ref) => !ref.startsWith(ATTRIBUTE))
    .flatMap((ref): Issue[] => {
      if (ref === quantity.name) {
        return [{ path, rule: 'expressao', message: `a expressão cita a própria grandeza ${ref}` }];
      }
      if (!names.has(ref)) {
        return [
          {
            path,
            rule: 'expressao',
            message: `a expressão cita a grandeza ${ref}, que não existe no perfil`,
          },
        ];
      }
      return [];
    });
}
