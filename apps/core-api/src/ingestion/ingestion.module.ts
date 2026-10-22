import { Module } from '@nestjs/common';
import {
  IngestionPipeline,
  type ClockPort,
  type DeviceDirectoryPort,
  type LoggerPort,
} from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { CatalogEvents } from '../catalog/catalog-events';
import { CatalogModule } from '../catalog/catalog.module';
import type { PrismaClient } from '../generated/prisma/client';
import { CLOCK, PRISMA } from '../infra/tokens';
import { PINO } from '../logging/logging.module';
import { AjvSchemaValidator } from './adapters/ajv-schema-validator';
import { BatchingMeasurementRepository } from './adapters/batching-measurement-repository';
import { PinoLogger } from './adapters/pino-logger';
import { PrismaDeviceDirectory } from './adapters/prisma-device-directory';
import { PostgresDeadLetters } from './adapters/postgres-dead-letters';
import { RedisDeduplication } from './adapters/redis-deduplication';
import { RedisStreamsEventBus } from './adapters/redis-streams-event-bus';
import { TimescaleMeasurementRepository } from './adapters/timescale-measurements';
import { IngestionController } from './http/ingestion.controller';
import type { IngestionConfig } from './infra/config';
import { BrokerMonitor } from './mqtt/broker-monitor';
import { MqttIngestionSubscriber } from './mqtt/mqtt-ingestion.subscriber';
import { DEVICE_DIRECTORY, INGESTION_CONFIG, LOGGER, PG_POOL, PIPELINE, REDIS } from './tokens';

@Module({
  imports: [CatalogModule],
  controllers: [IngestionController],
  providers: [
    {
      provide: LOGGER,
      inject: [PINO],
      useFactory: (logger: Logger): LoggerPort => new PinoLogger(logger),
    },
    {
      provide: DEVICE_DIRECTORY,
      inject: [PRISMA, CLOCK, CatalogEvents],
      useFactory: (
        prisma: PrismaClient,
        clock: ClockPort,
        events: CatalogEvents,
      ): DeviceDirectoryPort => {
        const directory = new PrismaDeviceDirectory(prisma, clock);
        events.onChange(() => directory.invalidate());
        return directory;
      },
    },
    {
      provide: PIPELINE,
      inject: [INGESTION_CONFIG, PG_POOL, REDIS, LOGGER, DEVICE_DIRECTORY, CLOCK],
      useFactory: (
        config: IngestionConfig,
        pool: Pool,
        redis: Redis,
        logger: LoggerPort,
        directory: DeviceDirectoryPort,
        clock: ClockPort,
      ) =>
        new IngestionPipeline({
          clock,
          validator: new AjvSchemaValidator(),
          deduplication: new RedisDeduplication(redis, config.deduplicationTtlSeconds),
          measurements: new BatchingMeasurementRepository(
            new TimescaleMeasurementRepository(pool),
            config.writeBatch,
          ),
          deadLetters: new PostgresDeadLetters(pool),
          eventBus: new RedisStreamsEventBus(redis, config.eventStreamMaxLength),
          directory,
          logger,
        }),
    },
    MqttIngestionSubscriber,
    BrokerMonitor,
  ],
})
export class IngestionModule {}
