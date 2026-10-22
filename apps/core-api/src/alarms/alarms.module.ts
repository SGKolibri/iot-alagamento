import { Module } from '@nestjs/common';
import type { ClockPort } from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { CatalogModule } from '../catalog/catalog.module';
import type { IngestionConfig } from '../ingestion/infra/config';
import { APP_CONFIG, CLOCK, PG_POOL, REDIS } from '../infra/tokens';
import { AlarmMetrics } from '../metrics/alarm-metrics';
import { ACTOR_CONTEXT } from './actor-context';
import { AlarmPublisher } from './alarm-publisher';
import { AlarmService } from './alarm-service';
import { AlarmsController } from './alarms.controller';
import { AlarmsRepository } from './alarms.repository';
import { HeaderActorContext } from './header-actor-context';

// Alarmes (RF-PRO-05): persistência, linha do tempo, fila do operador e eventos no barramento.
@Module({
  imports: [CatalogModule],
  controllers: [AlarmsController],
  providers: [
    { provide: AlarmsRepository, useFactory: () => new AlarmsRepository() },
    {
      provide: AlarmPublisher,
      inject: [REDIS, APP_CONFIG],
      useFactory: (redis: Redis, config: IngestionConfig) =>
        new AlarmPublisher(redis, config.eventStreamMaxLength),
    },
    {
      provide: AlarmService,
      inject: [PG_POOL, AlarmsRepository, AlarmPublisher, CLOCK, AlarmMetrics],
      useFactory: (
        pool: Pool,
        alarms: AlarmsRepository,
        publisher: AlarmPublisher,
        clock: ClockPort,
        metrics: AlarmMetrics,
      ) => new AlarmService(pool, alarms, publisher, clock, metrics),
    },
    // Adaptador de desenvolvimento; recusa subir com NODE_ENV=production (T3 troca pelo token).
    { provide: ACTOR_CONTEXT, useFactory: () => new HeaderActorContext() },
  ],
  exports: [AlarmsRepository, AlarmPublisher],
})
export class AlarmsModule {}
