import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { IngestionPipeline, LoggerPort } from '@iot/domain';
import mqtt, { type MqttClient } from 'mqtt';
import type { IngestionConfig } from '../infra/config';
import { INGESTION_CONFIG, LOGGER, PIPELINE } from '../tokens';
import { INGESTION_TOPICS, parseTopic } from './topic';

// Payload que não é JSON vai para a DLQ como texto, cortado neste limite.
export const RAW_PAYLOAD_LIMIT_BYTES = 2048;

// Corta em bytes sem partir um caractere UTF-8: recua enquanto o corte cair num byte de
// continuação (10xxxxxx).
function truncateUtf8(payload: Buffer, limit: number): string {
  let end = Math.min(payload.length, limit);
  while (end > 0 && end < payload.length && (payload[end]! & 0xc0) === 0x80) end -= 1;
  return payload.subarray(0, end).toString('utf8');
}

function parseBody(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    // A validação recusa o texto, e a DLQ guarda o tópico e o payload bruto truncado.
    return truncateUtf8(payload, RAW_PAYLOAD_LIMIT_BYTES);
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
