import { randomUUID } from 'node:crypto';
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
import { AbsenceSweep } from './absence-sweep';
import { ActionRunner } from './action-runner';
import { FetchWebhook } from './adapters/fetch-webhook';
import { MqttTopicPublisher } from './adapters/mqtt-topic-publisher';
import { RedisNotifications } from './adapters/redis-notifications';
import { RedisSuppression } from './adapters/redis-suppression';
import { DeviceAddresses } from './device-addresses';
import { RuleCatalog } from './rule-catalog';
import { RuleEngine, type IngestedEvent } from './rule-engine';
import { RuleEvents } from './rule-events';

// Grupo "rules" no stream measurement.ingested (ADR-011): confirma só depois de avaliar.
@Injectable()
export class RuleEngineConsumer implements OnModuleInit, OnModuleDestroy {
  private consumer?: StreamConsumer;
  private timer?: NodeJS.Timeout;
  private readonly topics: MqttTopicPublisher;
  private readonly actions: ActionRunner;
  readonly engine: RuleEngine;
  readonly absence: AbsenceSweep;

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
    this.topics = new MqttTopicPublisher(
      config.mqtt
        ? {
            url: config.mqtt.url,
            username: config.mqtt.username,
            password: config.mqtt.password,
            clientId: `${config.mqtt.clientId}-acoes-${process.pid}`,
          }
        : null,
    );
    this.actions = new ActionRunner(
      {
        notifications: new RedisNotifications(redis, config.eventStreamMaxLength),
        webhooks: new FetchWebhook(),
        topics: this.topics,
        suppression: new RedisSuppression(redis),
        clock,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        newId: () => randomUUID(),
      },
      logger,
    );
    this.engine = new RuleEngine(
      pool,
      catalog,
      alarms,
      publisher,
      clock,
      logger,
      this.actions,
      new DeviceAddresses(pool),
    );
    this.absence = new AbsenceSweep(pool, catalog, this.actions, clock, logger);
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
    this.timer = setInterval(() => void this.absence.sweep(), this.config.absenceSweepMs);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.consumer?.stop();
    await this.actions.drain();
    await this.topics.close();
  }
}
