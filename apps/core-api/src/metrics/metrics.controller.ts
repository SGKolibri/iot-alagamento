import { Controller, Get, Header, Inject } from '@nestjs/common';
import { IngestionMetrics } from './ingestion-metrics';

// Métricas no formato Prometheus (RF-OBS-01), fora do prefixo /api/v1, como o /health.
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(IngestionMetrics) private readonly metrics: IngestionMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async read(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
