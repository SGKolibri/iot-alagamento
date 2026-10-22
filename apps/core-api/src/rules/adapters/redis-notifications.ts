import type { Notification, NotificationPort } from '@iot/domain';
import type Redis from 'ioredis';

// A entrega por canal (e-mail, SMS, push) é da T1e: aqui o pedido vai para o barramento, no
// stream notification.requested, com o evento inteiro em JSON no campo "evento" (ADR-021).
export class RedisNotifications implements NotificationPort {
  constructor(
    private readonly redis: Redis,
    private readonly maxLength: number,
  ) {}

  async send(notification: Notification): Promise<void> {
    await this.redis.xadd(
      'notification.requested',
      'MAXLEN',
      '~',
      this.maxLength,
      '*',
      'evento',
      JSON.stringify({
        type: 'notification.requested',
        ...notification,
        occurredAt: notification.occurredAt.toISOString(),
      }),
    );
  }
}
