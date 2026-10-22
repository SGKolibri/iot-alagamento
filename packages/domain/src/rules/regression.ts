// Inclinação por minuto pela regressão linear de mínimos quadrados (x em minutos).
export function linearSlopePerMinute(points: { t: number; v: number }[]): number {
  if (points.length < 2) return 0;
  const origin = points[0]!.t;
  const xs = points.map((p) => (p.t - origin) / 60_000);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = points.reduce((sum, p) => sum + p.v, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((x, i) => {
    numerator += (x - meanX) * (points[i]!.v - meanY);
    denominator += (x - meanX) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}
