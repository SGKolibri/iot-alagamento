import type { Alarm } from '@iot/domain';
import type Redis from 'ioredis';

export type AlarmEventType = 'alarm.opened' | 'alarm.updated' | 'alarm.resolved';

export function alarmEvent(type: AlarmEventType, alarm: Alarm) {
  return {
    type,
    tenantId: alarm.tenantId,
    alarmId: alarm.id,
    ruleId: alarm.ruleId,
    ruleVersion: alarm.ruleVersion,
    deviceId: alarm.deviceId,
    severity: alarm.severity,
    state: alarm.state,
    occurredAt: alarm.occurredAt.toISOString(),
    openedAt: alarm.openedAt.toISOString(),
    at: alarm.events.at(-1)!.at.toISOString(),
  };
}

// Publica as mudanças de alarme no barramento interno (ADR-004), um stream por tipo, no mesmo
// formato de measurement.ingested (evento inteiro em JSON no campo "evento").
export class AlarmPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly maxLength: number,
  ) {}

  async publish(type: AlarmEventType, alarm: Alarm): Promise<void> {
    await this.redis.xadd(
      type,
      'MAXLEN',
      '~',
      this.maxLength,
      '*',
      'evento',
      JSON.stringify(alarmEvent(type, alarm)),
    );
  }
}
