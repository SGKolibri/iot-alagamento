import type { Issue } from '@iot/domain';

// RF-APP-07: parâmetros comuns a todas as listagens, com os limites do openapi.yaml.
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export interface ListQuery {
  page: number;
  limit: number;
  offset: number;
  sort: { field: string; direction: 'asc' | 'desc' };
}

export class ListQueryError extends Error {
  constructor(readonly issues: Issue[]) {
    super('parâmetros de listagem inválidos');
  }
}

const INTEGER = /^\d+$/;

function integer(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !INTEGER.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

// `sortable` mapeia o nome do campo na API para o campo no banco.
export function parseListQuery(
  query: Record<string, unknown>,
  options: { sortable: Record<string, string>; defaultSort: string },
): ListQuery {
  const issues: Issue[] = [];
  const page = integer(query.pagina, 1, 1, Number.MAX_SAFE_INTEGER);
  if (page === null) {
    issues.push({
      path: 'pagina',
      rule: 'consulta',
      message: 'precisa ser um inteiro de 1 em diante',
    });
  }
  const limit = integer(query.limite, DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) {
    issues.push({
      path: 'limite',
      rule: 'consulta',
      message: `precisa ser um inteiro de 1 a ${MAX_LIMIT}`,
    });
  }
  const requested =
    typeof query.ordenar === 'string' && query.ordenar ? query.ordenar : options.defaultSort;
  const descending = requested.startsWith('-');
  const name = descending ? requested.slice(1) : requested;
  const field = Object.hasOwn(options.sortable, name) ? options.sortable[name] : undefined;
  if (!field) {
    issues.push({
      path: 'ordenar',
      rule: 'consulta',
      message: `campo de ordenação não permitido: ${name} (aceitos: ${Object.keys(options.sortable).join(', ')})`,
    });
  }
  if (issues.length > 0) throw new ListQueryError(issues);
  return {
    page: page!,
    limit: limit!,
    offset: (page! - 1) * limit!,
    sort: { field: field!, direction: descending ? 'desc' : 'asc' },
  };
}
