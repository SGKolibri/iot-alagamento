import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { IngestionPipeline, LoggerPort } from '@iot/domain';
import mqtt, { type MqttClient } from 'mqtt';
import type { IngestionConfig } from '../infra/config';
import { INGESTION_CONFIG, LOGGER, PIPELINE } from '../tokens';
import { parseTopic, sharedSubscriptions } from './topic';

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

// Receber (MQTT): N conexões com identificador estável e sessão persistente, todas no mesmo grupo
// de assinatura compartilhada com QoS 1. O mqtt.js processa um pacote por vez em cada conexão e
// só confirma (PUBACK) depois que o pipeline termina; o paralelismo vem das conexões (ADR-017).
@Injectable()
export class MqttIngestionSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly clients: MqttClient[] = [];

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
    const topics = sharedSubscriptions(settings.shareGroup);
    await Promise.all(
      Array.from({ length: settings.connections }, (_, index) =>
        this.connect(settings, `${settings.clientId}-${index}`, topics),
      ),
    );
    this.logger.info(
      { topicos: topics, conexoes: settings.connections },
      'assinante MQTT conectado',
    );
  }

  private async connect(
    settings: NonNullable<IngestionConfig['mqtt']>,
    clientId: string,
    topics: string[],
  ): Promise<void> {
    const client = mqtt.connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId,
      clean: false,
      reconnectPeriod: settings.retryDelayMs,
    });
    let recovering = false;
    client.on('connect', () => {
      recovering = false;
    });
    client.handleMessage = (packet, done) => {
      this.handle(packet.topic, packet.payload as Buffer).then(
        () => done(),
        (error: unknown) => {
          // Falha transitória (banco ou Redis fora): a mensagem fica pendente, sem PUBACK. O
          // mqtt.js ignora o erro do done e não reentrega sozinho, então a conexão cai de
          // propósito; na reconexão a sessão persistente recebe de novo tudo o que não foi
          // confirmado (ADR-017).
          this.logger.error(
            { topico: packet.topic, conexao: clientId, erro: String(error) },
            'mensagem MQTT pendente: falha ao processar, sem confirmação',
          );
          done(error as Error);
          if (!recovering) {
            recovering = true;
            client.stream.destroy();
          }
        },
      );
    };
    client.on('error', (error) =>
      this.logger.error({ conexao: clientId, erro: error.message }, 'erro no cliente MQTT'),
    );
    this.clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });
    await client.subscribeAsync(topics, { qos: 1 });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.endAsync()));
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
