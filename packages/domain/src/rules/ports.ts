import type { AbsenceState, PairState, Severity } from './model';

// Estado por par regra e dispositivo; sobrevive a reinício (adaptadores PostgreSQL e Redis).
export interface RuleStatePort {
  get(ruleId: string, deviceId: string): Promise<PairState | null>;
  save(tenantId: string, ruleId: string, deviceId: string, state: PairState): Promise<void>;
  getAbsence(ruleId: string, deviceId: string): Promise<AbsenceState | null>;
  saveAbsence(
    tenantId: string,
    ruleId: string,
    deviceId: string,
    state: AbsenceState,
  ): Promise<void>;
}

export interface Notification {
  tenantId: string;
  channels: string[];
  ruleId: string;
  ruleName: string;
  deviceId: string;
  alarmId?: string;
  severity?: Severity;
  kind: 'abertura' | 'ausencia';
  occurredAt: Date;
  quantity?: string;
  value?: number;
}

export interface NotificationPort {
  send(notification: Notification): Promise<void>;
}

// Uma tentativa, com tempo limite; a repetição fica na estratégia do domínio.
export interface WebhookPort {
  post(url: string, body: unknown, timeoutMs: number): Promise<void>;
}

export interface TopicPublisherPort {
  publish(topic: string, payload: Record<string, unknown>): Promise<void>;
}

// Último aviso por chave (inquilino e dispositivo), para a janela de supressão.
export interface SuppressionPort {
  get(key: string): Promise<{ at: Date; severity: number } | null>;
  set(key: string, mark: { at: Date; severity: number }): Promise<void>;
}
