import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { AlarmsModule } from '../alarms/alarms.module';
import { CatalogModule } from '../catalog/catalog.module';
import { LoggingBridgeModule } from '../devices/logging-bridge.module';
import { PG_POOL } from '../infra/tokens';
import { RuleEngineConsumer } from './rule-engine.consumer';
import { RuleEvents } from './rule-events';
import { RulesController } from './rules.controller';
import { RulesRepository } from './rules.repository';

// Regras de processamento (RF-PRO-02, ADR-020).
@Module({
  imports: [CatalogModule, AlarmsModule, LoggingBridgeModule],
  controllers: [RulesController],
  providers: [
    RuleEvents,
    RuleEngineConsumer,
    {
      provide: RulesRepository,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new RulesRepository(pool),
    },
  ],
  exports: [RuleEvents, RulesRepository],
})
export class RulesModule {}
