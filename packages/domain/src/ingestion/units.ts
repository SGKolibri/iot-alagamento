// Normalização de unidades UCUM para a unidade canônica da grandeza (RF-PRO-01).
// Cada dimensão tem um fator para a unidade de referência; só converte dentro da mesma dimensão.
const DIMENSIONS: Record<string, Record<string, number>> = {
  comprimento: { mm: 0.001, cm: 0.01, m: 1 },
  // Stryker disable next-line ObjectLiteral: equivalente; dimensão de unidade única nunca converte.
  temperatura: { Cel: 1 },
  // Stryker disable next-line ObjectLiteral: equivalente; dimensão de unidade única nunca converte.
  razao: { '%': 1 },
  tensao: { mV: 0.001, V: 1 },
};

function factorOf(unit: string): { dimension: string; factor: number } | null {
  for (const [dimension, units] of Object.entries(DIMENSIONS)) {
    if (Object.hasOwn(units, unit)) return { dimension, factor: units[unit]! };
  }
  return null;
}

// Devolve o valor na unidade de destino, ou null se as unidades não forem conversíveis.
export function convertUnit(value: number, from: string, to: string): number | null {
  if (from === to) return value;
  const source = factorOf(from);
  const target = factorOf(to);
  if (!source || !target || source.dimension !== target.dimension) return null;
  // toPrecision corta o ruído de ponto flutuante (1.32 m vira 132 cm, e não 132.00000000000003).
  return Number(((value * source.factor) / target.factor).toPrecision(12));
}
