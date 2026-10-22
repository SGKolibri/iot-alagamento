import type { QuantitySpec } from '@iot/domain';

// Grandeza no formato do contrato (openapi.yaml, esquema Grandeza).
export interface Grandeza {
  nome: string;
  unidade: string;
  faixa?: { min?: number; max?: number };
  expressao?: string;
}

export function toQuantitySpec(g: Grandeza): QuantitySpec {
  return {
    name: g.nome,
    unit: g.unidade,
    ...(g.faixa ? { range: g.faixa } : {}),
    ...(g.expressao !== undefined ? { expression: g.expressao } : {}),
  };
}

export function toGrandeza(q: QuantitySpec): Grandeza {
  return {
    nome: q.name,
    unidade: q.unit,
    ...(q.range ? { faixa: q.range } : {}),
    ...(q.expression !== undefined ? { expressao: q.expression } : {}),
  };
}
