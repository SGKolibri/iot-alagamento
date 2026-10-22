import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { DataModule } from './data/data.module';
import { DevicesModule } from './devices/devices.module';
import { HealthController } from './health.controller';
import { InfraModule } from './infra/infra.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { LoggingModule } from './logging/logging.module';
import { MetricsModule } from './metrics/metrics.module';
import { RulesModule } from './rules/rules.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    LoggingModule,
    MetricsModule,
    InfraModule,
    TenancyModule,
    CatalogModule,
    DevicesModule,
    DataModule,
    RulesModule,
    IngestionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
