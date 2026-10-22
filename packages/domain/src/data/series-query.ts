import type { Issue } from '../ingestion/model';

// RF-DAD-01: regras da consulta da série (intervalo, bucket e limite de pontos).
export const BUCKETS = { '1m': 60, '15m': 900, '1h': 3600 } as const;
export type Bucket = keyof typeof BUCKETS;
export const MAX_SERIES_POINTS = 50_000;
export const DEFAULT_RANGE_HOURS = 24;

const HOUR_MS = 3_600_000;
const NAMES = Object.keys(BUCKETS);
const BUCKET_LIST = `${NAMES.slice(0, -1).join(', ')} ou ${NAMES.at(-1)}`;

export function parseBucket(
  value: string | undefined,
): { bucket: null } | { bucket: Bucket; seconds: number } | { issue: Issue } {
  if (value === undefined || value === '') return { bucket: null };
  if (Object.hasOwn(BUCKETS, value)) {
    const bucket = value as Bucket;
    return { bucket, seconds: BUCKETS[bucket] };
  }
  return {
    issue: {
      path: 'bucket',
      rule: 'consulta',
      message: `bucket desconhecido: ${value} (aceitos: ${Object.keys(BUCKETS).join(', ')})`,
    },
  };
}

function parseDate(value: string | undefined): Date | null | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Sem de e ate, vale as últimas 24 h até agora; com um só, a janela de 24 h se ancora nele.
export function resolveRange(
  de: string | undefined,
  ate: string | undefined,
  now: Date,
): { from: Date; to: Date } | { issue: Issue } {
  const from = parseDate(de);
  const to = parseDate(ate);
  if (from === null)
    return { issue: { path: 'de', rule: 'consulta', message: `data inválida: ${de}` } };
  if (to === null)
    return { issue: { path: 'ate', rule: 'consulta', message: `data inválida: ${ate}` } };
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_HOURS * HOUR_MS);
  if (start.getTime() >= end.getTime()) {
    return { issue: { path: 'de', rule: 'consulta', message: 'de precisa ser anterior a ate' } };
  }
  return { from: start, to: end };
}

export function tooManyPoints(points: number): Issue | null {
  if (points <= MAX_SERIES_POINTS) return null;
  return {
    path: '',
    rule: 'pontos_demais',
    message: `a consulta passa de ${MAX_SERIES_POINTS} pontos; use um bucket maior (${BUCKET_LIST}) ou um intervalo menor`,
  };
}
