export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

export const RECONNECT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 30_000 };

// Espera exponencial com jitter: o teto dobra a cada tentativa (base, 2x, 4x...) até maxMs, e o
// atraso sorteado fica entre a metade e o teto, para as conexões não voltarem todas juntas.
export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** Math.min(attempt, 30));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export class Backoff {
  private attempt = 0;

  constructor(
    private readonly options: BackoffOptions = RECONNECT_BACKOFF,
    private readonly random: () => number = Math.random,
  ) {}

  next(): number {
    return backoffDelay(this.attempt++, this.options, this.random);
  }

  reset(): void {
    this.attempt = 0;
  }
}
