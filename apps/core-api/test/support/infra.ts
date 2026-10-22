import { join, resolve } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import pg from 'pg';

const repoRoot = resolve(__dirname, '../../../..');

// Mesmas imagens do compose.yaml.
const IMAGES = {
  postgres: 'timescale/timescaledb-ha:pg17.11-ts2.31.0',
  redis: 'redis:8.8.3-alpine',
  mosquitto: 'eclipse-mosquitto:2.0.22',
};

const CREDENTIALS = {
  postgres: { user: 'iot', password: 'senha-teste-pg', database: 'iot' },
  redis: 'senha-teste-redis',
  mqtt: { username: 'teste', password: 'senha-teste-mqtt' },
};

export interface Infra {
  env: Record<string, string>;
  stop(): Promise<void>;
}

async function waitForPostgres(config: pg.ClientConfig): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const client = new pg.Client(config);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function startInfra(): Promise<Infra> {
  const [postgres, redis, mosquitto] = await Promise.all([
    new GenericContainer(IMAGES.postgres)
      .withEnvironment({
        POSTGRES_USER: CREDENTIALS.postgres.user,
        POSTGRES_PASSWORD: CREDENTIALS.postgres.password,
        POSTGRES_DB: CREDENTIALS.postgres.database,
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U iot -d iot'],
        interval: 1000,
        timeout: 3000,
        retries: 60,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start(),
    new GenericContainer(IMAGES.redis)
      .withCommand(['redis-server', '--requirepass', CREDENTIALS.redis])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    // Sem bind mount: os arquivos são copiados, o que evita o rótulo SELinux no host.
    new GenericContainer(IMAGES.mosquitto)
      .withCopyFilesToContainer([
        {
          source: join(repoRoot, 'infra/mosquitto/mosquitto.conf'),
          target: '/mosquitto/config/mosquitto.conf',
        },
        { source: join(repoRoot, 'infra/mosquitto/entrypoint.sh'), target: '/infra/entrypoint.sh' },
      ])
      .withEnvironment({
        MQTT_DEV_USERNAME: CREDENTIALS.mqtt.username,
        MQTT_DEV_PASSWORD: CREDENTIALS.mqtt.password,
      })
      .withEntrypoint(['sh', '/infra/entrypoint.sh'])
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/))
      .start(),
  ]);

  const env = {
    POSTGRES_HOST: postgres.getHost(),
    POSTGRES_PORT: String(postgres.getMappedPort(5432)),
    POSTGRES_USER: CREDENTIALS.postgres.user,
    POSTGRES_PASSWORD: CREDENTIALS.postgres.password,
    POSTGRES_DB: CREDENTIALS.postgres.database,
    REDIS_HOST: redis.getHost(),
    REDIS_PORT: String(redis.getMappedPort(6379)),
    REDIS_PASSWORD: CREDENTIALS.redis,
    MQTT_HOST: mosquitto.getHost(),
    MQTT_PORT: String(mosquitto.getMappedPort(1883)),
    MQTT_INGEST_USERNAME: CREDENTIALS.mqtt.username,
    MQTT_INGEST_PASSWORD: CREDENTIALS.mqtt.password,
  };
  await waitForPostgres({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
  });

  const containers: StartedTestContainer[] = [postgres, redis, mosquitto];
  return {
    env,
    stop: async () => {
      await Promise.all(containers.map((c) => c.stop()));
    },
  };
}

export const MIGRATIONS_DIR = join(repoRoot, 'migrations/sql');
export const FIXTURE_DIRECTORY = join(__dirname, '../fixtures/device-directory.json');
