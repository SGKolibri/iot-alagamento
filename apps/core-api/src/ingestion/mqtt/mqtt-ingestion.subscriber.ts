import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { IngestionPipeline, LoggerPort } from '@iot/domain';
import mqtt, { type MqttClient } from 'mqtt';
import type { IngestionConfig } from '../infra/config';
import { INGESTION_CONFIG, LOGGER, PIPELINE } from '../tokens';
import { INGESTION_TOPICS, parseTopic } from './topic';

function parseBody(payload: Buffer): unknown {
  const text = payload.toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Corpo que não é JSON segue como texto; a validação recusa e a DLQ guarda o original.
    return text;
  }
}

// Receber (MQTT): assina os tópicos de ingestão com QoS 1 e só confirma (PUBACK) depois que
// o pipeline termina, para nenhuma mensagem confirmada se perder (RNF-10).
@Injectable()
export class MqttIngestionSubscriber implements OnModuleInit, OnModuleDestroy {
  private client?: MqttClient;

  constructor(
    @Inject(INGESTION_CONFIG) private readonly config: IngestionConfig,
    @Inject(PIPELINE) private readonly pipeline: IngestionPipeline,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = this.config.mqtt;
    if (!settings) {
      this.logger.info({}, 'assinante MQTT desligado (MQTT_HOST não definido)');
      return;
    }
    const client = mqtt.connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      clean: false,
    });
    client.handleMessage = (packet, done) => {
      this.handle(packet.topic, packet.payload as Buffer).then(
        () => done(),
        (error: unknown) => {
          this.logger.error(
            { topico: packet.topic, erro: String(error) },
            'falha ao processar MQTT',
          );
          done(error as Error);
        },
      );
    };
    client.on('error', (error) =>
      this.logger.error({ erro: error.message }, 'erro no cliente MQTT'),
    );
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });
    await client.subscribeAsync(INGESTION_TOPICS, { qos: 1 });
    this.logger.info({ topicos: INGESTION_TOPICS }, 'assinante MQTT conectado');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync();
  }

  async handle(topic: string, payload: Buffer): Promise<void> {
    const address = parseTopic(topic);
    if (!address) {
      this.logger.warn({ topico: topic }, 'tópico fora do padrão ignorado');
      return;
    }
    await this.pipeline.ingestMessage({ source: 'mqtt', topic: address, body: parseBody(payload) });
  }
}
