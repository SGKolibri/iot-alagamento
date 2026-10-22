import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { LoggerPort } from '@iot/domain';
import mqtt, { type MqttClient } from 'mqtt';
import { IngestionMetrics } from '../../metrics/ingestion-metrics';
import type { IngestionConfig } from '../infra/config';
import { INGESTION_CONFIG, LOGGER } from '../tokens';

export const DROPPED_TOPIC = '$SYS/broker/publish/messages/dropped';
export const STORED_TOPIC = '$SYS/broker/store/messages/count';

// Monitor do broker (ADR-017): lê os contadores $SYS com uma conexão própria, sem sessão, e os
// expõe em /metrics. Descarte é perda de mensagem confirmada: cada aumento vira log de erro.
@Injectable()
export class BrokerMonitor implements OnModuleInit, OnModuleDestroy {
  private client?: MqttClient;
  private lastDropped?: number;

  constructor(
    @Inject(INGESTION_CONFIG) private readonly config: IngestionConfig,
    @Inject(IngestionMetrics) private readonly metrics: IngestionMetrics,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = this.config.mqtt;
    if (!settings) return;
    const client = mqtt.connect(settings.url, {
      clientId: `${settings.clientId}-monitor`,
      clean: true,
      username: settings.monitor.username,
      password: settings.monitor.password,
    });
    client.on('message', (topic, payload) => this.observe(topic, Number(payload.toString())));
    client.on('connect', () => {
      void client
        .subscribeAsync([DROPPED_TOPIC, STORED_TOPIC])
        .catch((error: unknown) =>
          this.logger.error(
            { erro: String(error) },
            'monitor do broker não assinou os contadores $SYS',
          ),
        );
    });
    client.on('error', (error) =>
      this.logger.error({ erro: error.message }, 'erro no monitor do broker'),
    );
    this.client = client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync();
  }

  observe(topic: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (topic === STORED_TOPIC) {
      this.metrics.brokerPending.set(value);
      return;
    }
    if (topic !== DROPPED_TOPIC) return;
    // O contador do broker é acumulado desde a subida dele; se voltar a zero, o broker reiniciou.
    const previous = this.lastDropped ?? 0;
    const increase = value >= previous ? value - previous : value;
    this.lastDropped = value;
    if (increase > 0) {
      this.metrics.brokerDropped.inc(increase);
      this.logger.error(
        { descartadas: increase, total_no_broker: value },
        'o broker MQTT descartou mensagens: fila de sessão cheia (RNF-10)',
      );
    }
  }
}
