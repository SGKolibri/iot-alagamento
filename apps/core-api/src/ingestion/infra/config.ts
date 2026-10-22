import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function findRepoRoot(start: string = __dirname): string {
  let dir = start;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('raiz do repositório não encontrada');
    dir = parent;
  }
  return dir;
}

export interface IngestionConfig {
  postgres: { host: string; port: number; user?: string; password?: string; database?: string };
  redis: { host: string; port: number; password?: string };
  // Sem MQTT_HOST o assinante MQTT não sobe (por exemplo, no teste de fumaça do app).
  mqtt?: {
    url: string;
    username?: string;
    password?: string;
    clientId: string;
    retryDelayMs: number;
    // Conexões paralelas no mesmo grupo de assinatura compartilhada (ADR-017).
    connections: number;
    shareGroup: string;
  };
  // Gravação em grupo das medições: até maxRows linhas ou maxWaitMs de espera.
  writeBatch: { maxRows: number; maxWaitMs: number };
  // Consumidor de eventos e varredura de estado só rodam com Redis configurado (REDIS_HOST).
  backgroundJobs: boolean;
  statusSweepMs: number;
  deduplicationTtlSeconds: number;
  eventStreamMaxLength: number;
}

export function loadIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig {
  return {
    postgres: {
      host: env.POSTGRES_HOST ?? 'localhost',
      port: Number(env.POSTGRES_PORT ?? 5432),
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
    },
    redis: {
      host: env.REDIS_HOST ?? 'localhost',
      port: Number(env.REDIS_PORT ?? 6379),
      password: env.REDIS_PASSWORD,
    },
    mqtt: env.MQTT_HOST
      ? {
          url: `mqtt://${env.MQTT_HOST}:${env.MQTT_PORT ?? 1883}`,
          username: env.MQTT_INGEST_USERNAME ?? env.MQTT_DEV_USERNAME,
          password: env.MQTT_INGEST_PASSWORD ?? env.MQTT_DEV_PASSWORD,
          clientId: env.MQTT_INGEST_CLIENT_ID ?? 'core-api-ingestao',
          retryDelayMs: Number(env.MQTT_INGEST_RETRY_MS ?? 2000),
          connections: Number(env.MQTT_INGEST_CONNECTIONS ?? 32),
          shareGroup: env.MQTT_INGEST_SHARE_GROUP ?? 'core-api',
        }
      : undefined,
    writeBatch: {
      maxRows: Number(env.INGEST_WRITE_BATCH_ROWS ?? 2000),
      maxWaitMs: Number(env.INGEST_WRITE_BATCH_WAIT_MS ?? 5),
    },
    backgroundJobs: Boolean(env.REDIS_HOST),
    statusSweepMs: Number(env.DEVICE_STATUS_SWEEP_MS ?? 30_000),
    deduplicationTtlSeconds: Number(env.DEDUP_TTL_SECONDS ?? 7 * 24 * 3600),
    eventStreamMaxLength: Number(env.EVENT_STREAM_MAXLEN ?? 100_000),
  };
}
