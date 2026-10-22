import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { LoggerPort } from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import type { IngestionConfig } from '../ingestion/infra/config';
import { LOGGER } from '../ingestion/tokens';
import { StreamConsumer } from '../infra/stream-consumer';
import { APP_CONFIG, PG_POOL, REDIS } from '../infra/tokens';
import { LastValuesStore } from './last-values.store';

interface IngestedEvent {
  tenantId: string;
  deviceId: string;
  messageId: string;
  timestamp: string;
  late: boolean;
  measurements: {
    quantity: string;
    value: number;
    unit: string;
    suspect: boolean;
    derived: boolean;
  }[];
}

// RF-DAD-02: mantém o último valor por dispositivo e grandeza a partir de measurement.ingested.
// Tolera eventos repetidos (ADR-011): a mesma medição não muda nada.
@Injectable()
export class LastValuesConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer?: StreamConsumer;
  readonly store: LastValuesStore;

  constructor(
    @Inject(APP_CONFIG) private readonly config: IngestionConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_POOL) pool: Pool,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {
    this.store = new LastValuesStore(redis, pool);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.backgroundJobs) return;
    this.consumer = new StreamConsumer(
      this.redis,
      'measurement.ingested',
      'last-values',
      `core-api-${process.pid}`,
      (payload) => this.handle(payload as IngestedEvent),
      this.logger,
    );
    await this.consumer.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.stop();
  }

  async handle(event: IngestedEvent): Promise<void> {
    const timestamp = new Date(event.timestamp);
    await this.store.save(
      event.tenantId,
      event.deviceId,
      event.measurements.map((m) => ({
        quantity: m.quantity,
        value: m.value,
        unit: m.unit,
        timestamp,
        late: event.late,
        suspect: m.suspect,
        derived: m.derived,
        messageId: event.messageId,
      })),
    );
  }
}
