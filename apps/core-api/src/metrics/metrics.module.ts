import { Global, Module } from '@nestjs/common';
import { AlarmMetrics } from './alarm-metrics';
import { IngestionMetrics } from './ingestion-metrics';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  providers: [IngestionMetrics, AlarmMetrics],
  controllers: [MetricsController],
  exports: [IngestionMetrics, AlarmMetrics],
})
export class MetricsModule {}
