import { MAX_SERIES_POINTS, parseBucket, resolveRange, tooManyPoints } from '../../src';

const now = new Date('2026-10-22T12:00:00Z');

describe('consulta da série (RF-DAD-01)', () => {
  it('buckets aceitos e seus tamanhos em segundos', () => {
    expect(parseBucket(undefined)).toEqual({ bucket: null });
    expect(parseBucket('1m')).toEqual({ bucket: '1m', seconds: 60 });
    expect(parseBucket('15m')).toEqual({ bucket: '15m', seconds: 900 });
    expect(parseBucket('1h')).toEqual({ bucket: '1h', seconds: 3600 });
  });

  it('bucket desconhecido é recusado com o caminho do parâmetro', () => {
    expect(parseBucket('5m')).toEqual({
      issue: {
        path: 'bucket',
        rule: 'consulta',
        message: 'bucket desconhecido: 5m (aceitos: 1m, 15m, 1h)',
      },
    });
  });

  it('sem de e ate, vale as últimas 24 h', () => {
    expect(resolveRange(undefined, undefined, now)).toEqual({
      from: new Date('2026-10-21T12:00:00Z'),
      to: now,
    });
  });

  it('só de: até agora; só ate: 24 h antes', () => {
    expect(resolveRange('2026-10-22T10:00:00Z', undefined, now)).toEqual({
      from: new Date('2026-10-22T10:00:00Z'),
      to: now,
    });
    expect(resolveRange(undefined, '2026-10-20T00:00:00Z', now)).toEqual({
      from: new Date('2026-10-19T00:00:00Z'),
      to: new Date('2026-10-20T00:00:00Z'),
    });
  });

  it.each([
    ['ontem', undefined, 'de', 'data inválida: ontem'],
    [undefined, 'x', 'ate', 'data inválida: x'],
    ['2026-10-22T12:00:00Z', '2026-10-22T11:00:00Z', 'de', 'de precisa ser anterior a ate'],
    ['2026-10-22T12:00:00Z', '2026-10-22T12:00:00Z', 'de', 'de precisa ser anterior a ate'],
  ])('recusa de=%s ate=%s', (de, ate, path, message) => {
    expect(resolveRange(de, ate, now)).toEqual({ issue: { path, rule: 'consulta', message } });
  });

  it('acima do limite de pontos há erro claro, com a saída sugerida', () => {
    expect(MAX_SERIES_POINTS).toBe(50_000);
    expect(tooManyPoints(50_000)).toBeNull();
    expect(tooManyPoints(50_001)).toEqual({
      path: '',
      rule: 'pontos_demais',
      message:
        'a consulta passa de 50000 pontos; use um bucket maior (1m, 15m ou 1h) ou um intervalo menor',
    });
  });
});
