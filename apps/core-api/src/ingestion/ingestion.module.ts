import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { IngestionPipeline, type LoggerPort } from '@iot/domain';
import Redis from 'ioredis';
import { Pool } from 'pg';
import type { Logger } from 'pino';
import { AjvSchemaValidator } from './adapters/ajv-schema-validator';
import { MemoryDeviceDirectory } from './adapters/memory-device-directory';
import { PinoLogger } from './adapters/pino-logger';
import { PostgresDeadLetters } from './adapters/postgres-dead-letters';
import { RedisDeduplication } from './adapters/redis-deduplication';
import { RedisStreamsEventBus } from './adapters/redis-streams-event-bus';
import { SystemClock } from './adapters/system-clock';
import { TimescaleMeasurementRepository } from './adapters/timescale-measurements';
import { IngestionController } from './http/ingestion.controller';
import { TelemetryController } from './http/telemetry.controller';
import { loadIngestionConfig, type IngestionConfig } from './infra/config';
import { PINO } from '../logging/logging.module';
import { MqttIngestionSubscriber } from './mqtt/mqtt-ingestion.subscriber';
import { INGESTION_CONFIG, LOGGER, PG_POOL, PIPELINE, REDIS } from './tokens';

@Module({
  controllers: [IngestionController, TelemetryController],
  providers: [
    { provide: INGESTION_CONFIG, useFactory: () => loadIngestionConfig() },
    {
      provide: LOGGER,
      inject: [PINO],
      useFactory: (logger: Logger): LoggerPort => new PinoLogger(logger),
    },
    {
      provide: PG_POOL,
      inject: [INGESTION_CONFIG],
      useFactory: (config: IngestionConfig) => new Pool({ ...config.postgres, max: 10 }),
    },
    {
      provide: REDIS,
      inject: [INGESTION_CONFIG],
      // lazyConnect: o app sobe mesmo sem Redis; a conexão abre no primeiro comando.
      useFactory: (config: IngestionConfig) =>
        new Redis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 3 }),
    },
    {
      provide: PIPELINE,
      inject: [INGESTION_CONFIG, PG_POOL, REDIS, LOGGER],
      useFactory: (config: IngestionConfig, pool: Pool, redis: Redis, logger: LoggerPort) =>
        new IngestionPipeline({
          clock: new SystemClock(),
          validator: new AjvSchemaValidator(),
          deduplication: new RedisDeduplication(redis, config.deduplicationTtlSeconds),
          measurements: new TimescaleMeasurementRepository(pool),
          deadLetters: new PostgresDeadLetters(pool),
          eventBus: new RedisStreamsEventBus(redis, config.eventStreamMaxLength),
          directory: MemoryDeviceDirectory.fromFile(config.deviceDirectoryFile),
          logger,
        }),
    },
    MqttIngestionSubscriber,
  ],
})
export class IngestionModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.redis.disconnect();
  }
}
