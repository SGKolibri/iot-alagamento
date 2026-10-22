import type { TopicPublisherPort } from '@iot/domain';
import mqtt from 'mqtt';

// Publicação das ações publicar_topico e enviar_comando, com QoS 1. A conexão abre no primeiro
// uso e é reaproveitada.
export class MqttTopicPublisher implements TopicPublisherPort {
  private client?: Promise<mqtt.MqttClient>;

  constructor(
    private readonly options: {
      url: string;
      username?: string;
      password?: string;
      clientId: string;
    } | null,
  ) {}

  async publish(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.options) throw new Error('MQTT não configurado (MQTT_HOST)');
    this.client ??= mqtt.connectAsync(this.options.url, {
      username: this.options.username,
      password: this.options.password,
      clientId: this.options.clientId,
      reconnectPeriod: 1000,
    });
    const client = await this.client;
    await client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
  }

  async close(): Promise<void> {
    const client = await this.client?.catch(() => undefined);
    await client?.endAsync();
  }
}
