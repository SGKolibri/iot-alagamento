import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ClockPort, LoggerPort } from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { AlarmPublisher } from '../alarms/alarm-publisher';
import { AlarmsRepository } from '../alarms/alarms.repository';
import type { IngestionConfig } from '../ingestion/infra/config';
import { LOGGER } from '../ingestion/tokens';
import { StreamConsumer } from '../infra/stream-consumer';
import { APP_CONFIG, CLOCK, PG_POOL, REDIS } from '../infra/tokens';
import { RuleCatalog } from './rule-catalog';
import { RuleEngine, type IngestedEvent } from './rule-engine';
import { RuleEvents } from './rule-events';

// Grupo "rules" no stream measurement.ingested (ADR-011): confirma só depois de avaliar.
@Injectable()
export class RuleEngineConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer?: StreamConsumer;
  readonly engine: RuleEngine;

  constructor(
    @Inject(APP_CONFIG) private readonly config: IngestionConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_POOL) pool: Pool,
    @Inject(CLOCK) clock: ClockPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
    @Inject(AlarmsRepository) alarms: AlarmsRepository,
    @Inject(AlarmPublisher) publisher: AlarmPublisher,
    @Inject(RuleEvents) events: RuleEvents,
  ) {
    const catalog = new RuleCatalog(pool);
    events.onChange((tenantId) => catalog.invalidate(tenantId));
    this.engine = new RuleEngine(pool, catalog, alarms, publisher, clock, logger);
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.backgroundJobs) return;
    this.consumer = new StreamConsumer(
      this.redis,
      'measurement.ingested',
      'rules',
      `core-api-${process.pid}`,
      (payload) => this.engine.handle(payload as IngestedEvent),
      this.logger,
    );
    await this.consumer.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.stop();
  }
}
