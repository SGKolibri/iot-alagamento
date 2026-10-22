import { Inject, Injectable } from '@nestjs/common';
import type { Alarm } from '@iot/domain';
import { Counter, Histogram } from 'prom-client';
import { IngestionMetrics } from './ingestion-metrics';

// RF-OBS-01 e RNF-02: alarmes abertos e resolvidos, e o tempo do recebimento da medição até a
// abertura do alarme (meta de 3 s).
@Injectable()
export class AlarmMetrics {
  private readonly opened: Counter<'severidade'>;
  private readonly resolved: Counter<'resolucao'>;
  private readonly openLatency: Histogram;

  constructor(@Inject(IngestionMetrics) metrics: IngestionMetrics) {
    const registers = [metrics.registry];
    this.opened = new Counter({
      name: 'alarmes_abertos_total',
      help: 'Alarmes abertos pelo motor de regras, por severidade',
      labelNames: ['severidade'] as const,
      registers,
    });
    this.resolved = new Counter({
      name: 'alarmes_resolvidos_total',
      help: 'Alarmes resolvidos, por resolução (automatica ou manual)',
      labelNames: ['resolucao'] as const,
      registers,
    });
    this.openLatency = new Histogram({
      name: 'regras_latencia_abertura_alarme_segundos',
      help: 'Tempo do recebimento da medição pela ingestão até a abertura do alarme',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
      registers,
    });
  }

  alarmOpened(alarm: Alarm, receivedAt: Date): void {
    this.opened.inc({ severidade: alarm.severity });
    this.openLatency.observe(Math.max(0, alarm.openedAt.getTime() - receivedAt.getTime()) / 1000);
  }

  alarmResolved(alarm: Alarm): void {
    this.resolved.inc({ resolucao: alarm.resolution ?? 'automatica' });
  }
}
