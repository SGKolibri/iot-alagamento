// Inclinação por minuto pela regressão linear de mínimos quadrados (x em minutos):
// Σ(x − x̄)·y / Σ(x − x̄)². Com menos de 2 pontos ou todos no mesmo instante, a inclinação é 0.
export function linearSlopePerMinute(points: { t: number; v: number }[]): number {
  if (points.length < 2) return 0;
  const xs = points.map((p) => p.t / 60_000);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, i) => {
    numerator += (x - meanX) * points[i]!.v;
    denominator += (x - meanX) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}
