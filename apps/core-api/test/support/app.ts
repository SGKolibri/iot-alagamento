import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import pg from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { applyMigrations } from '../../src/ingestion/infra/sql-migrations';
import { MIGRATIONS_DIR, startInfra, type Infra } from './infra';

export interface TestApp {
  infra: Infra;
  app: NestExpressApplication;
  db: pg.Pool;
  redis: Redis;
  // Derruba o app sem desligamento limpo (sockets MQTT destruídos, sem DISCONNECT) e sobe outro
  // sobre a mesma infraestrutura, como numa queda do processo.
  crashApp(): Promise<void>;
  startApp(): Promise<void>;
  close(): Promise<void>;
}

async function bootApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

// Destrói os sockets de todo cliente MQTT encontrado nos provedores do app.
function destroyMqttSockets(app: NestExpressApplication): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) return;
    seen.add(value);
    const stream = (value as { stream?: { destroy?: () => void } }).stream;
    if ((value as { options?: { clientId?: unknown } }).options?.clientId && stream?.destroy) {
      (value as { options: { reconnectPeriod: number } }).options.reconnectPeriod = 0;
      stream.destroy();
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) visit(child, depth + 1);
  };
  const container = (
    app as unknown as {
      container: { getModules(): Map<string, { providers: Map<unknown, { instance: unknown }> }> };
    }
  ).container;
  for (const module of container.getModules().values()) {
    for (const wrapper of module.providers.values()) visit(wrapper.instance, 0);
  }
}

// Sobe PostgreSQL, Redis e Mosquitto, aplica as migrações e cria o app com o AppModule real.
export async function startTestApp(extraEnv: Record<string, string> = {}): Promise<TestApp> {
  const infra = await startInfra();
  Object.assign(process.env, infra.env, { LOG_LEVEL: 'silent' }, extraEnv);
  const db = new pg.Pool({
    host: infra.env.POSTGRES_HOST,
    port: Number(infra.env.POSTGRES_PORT),
    user: infra.env.POSTGRES_USER,
    password: infra.env.POSTGRES_PASSWORD,
    database: infra.env.POSTGRES_DB,
  });
  await applyMigrations(db, MIGRATIONS_DIR);
  const redis = new Redis({
    host: infra.env.REDIS_HOST,
    port: Number(infra.env.REDIS_PORT),
    password: infra.env.REDIS_PASSWORD,
  });
  const t: TestApp = {
    infra,
    app: await bootApp(),
    db,
    redis,
    crashApp: async () => {
      destroyMqttSockets(t.app);
      await t.app.close().catch(() => undefined);
    },
    startApp: async () => {
      t.app = await bootApp();
    },
    close: async () => {
      await t.app.close();
      await db.end();
      redis.disconnect();
      await infra.stop();
    },
  };
  return t;
}

// Inquilinos são criados pelo administrador da plataforma (fora do escopo da T1b).
export async function createTenant(db: pg.Pool, slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id',
    [slug],
  );
  return rows[0]!.id;
}
