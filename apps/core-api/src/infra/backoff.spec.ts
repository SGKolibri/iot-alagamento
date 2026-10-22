import { Backoff, backoffDelay } from './backoff';

describe('espera crescente com jitter (T1c, parte A)', () => {
  it('numa queda longa, as tentativas por minuto caem com o tempo', () => {
    // Relógio simulado: cada tentativa falha e a próxima sai depois do atraso do Backoff.
    const backoff = new Backoff({ baseMs: 500, maxMs: 30_000 }, () => 0.5);
    const attempts: number[] = [];
    let now = 0;
    while (now < 10 * 60_000) {
      attempts.push(now);
      now += backoff.next();
    }
    const perMinute = Array.from(
      { length: 10 },
      (_, minute) =>
        attempts.filter((t) => t >= minute * 60_000 && t < (minute + 1) * 60_000).length,
    );
    // Começa com várias tentativas e, perto do teto de 30 s, fica em 2 ou 3 por minuto.
    expect(perMinute[0]).toBeGreaterThan(perMinute[1]!);
    expect(perMinute[0]).toBeGreaterThanOrEqual(8);
    expect(perMinute.slice(2).every((n) => n <= 3)).toBe(true);
    expect(perMinute[1]).toBeGreaterThanOrEqual(Math.max(...perMinute.slice(2)));
  });

  it('o atraso dobra a cada tentativa até o teto, com jitter entre metade e o valor cheio', () => {
    const low = () => 0;
    const high = () => 0.999999;
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, { baseMs: 500, maxMs: 30_000 }, high))).toEqual([
      500, 1000, 2000, 4000,
    ]);
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, { baseMs: 500, maxMs: 30_000 }, low))).toEqual([
      250, 500, 1000, 2000,
    ]);
    expect(backoffDelay(30, { baseMs: 500, maxMs: 30_000 }, high)).toBe(30_000);
    expect(backoffDelay(1000, { baseMs: 500, maxMs: 30_000 }, low)).toBe(15_000);
  });

  it('reset volta ao atraso inicial depois de um sucesso', () => {
    const backoff = new Backoff({ baseMs: 500, maxMs: 30_000 }, () => 0.999999);
    backoff.next();
    backoff.next();
    expect(backoff.next()).toBe(2000);
    backoff.reset();
    expect(backoff.next()).toBe(500);
  });
});
