import { Global, Module } from '@nestjs/common';
import { IngestionMetrics } from './ingestion-metrics';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  providers: [IngestionMetrics],
  controllers: [MetricsController],
  exports: [IngestionMetrics],
})
export class MetricsModule {}
