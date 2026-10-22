import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import type { IngestionConfig } from '../ingestion/infra/config';
import { APP_CONFIG, REDIS } from '../infra/tokens';
import { AlarmPublisher } from './alarm-publisher';
import { AlarmsRepository } from './alarms.repository';

// Alarmes (RF-PRO-05): persistência, linha do tempo e eventos no barramento.
@Module({
  providers: [
    { provide: AlarmsRepository, useFactory: () => new AlarmsRepository() },
    {
      provide: AlarmPublisher,
      inject: [REDIS, APP_CONFIG],
      useFactory: (redis: Redis, config: IngestionConfig) =>
        new AlarmPublisher(redis, config.eventStreamMaxLength),
    },
  ],
  exports: [AlarmsRepository, AlarmPublisher],
})
export class AlarmsModule {}
