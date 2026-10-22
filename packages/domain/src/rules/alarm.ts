import type { Severity } from './model';

export type AlarmState = 'ATIVO' | 'RECONHECIDO' | 'RESOLVIDO';

export interface AlarmEvent {
  type: 'aberto' | 'reconhecido' | 'resolvido';
  at: Date;
  actor?: string;
  note?: string;
  reason?: string;
  measuredAt?: Date;
}

export interface Alarm {
  id: string;
  tenantId: string;
  ruleId: string;
  ruleVersion: number;
  deviceId: string;
  severity: Severity;
  state: AlarmState;
  // Horário da medição que abriu o alarme (RF-PRO-05: o alarme vindo da borda mantém a origem).
  occurredAt: Date;
  openedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  acknowledgeNote?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: 'automatica' | 'manual';
  resolveReason?: string;
  events: AlarmEvent[];
}

export class AlarmTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlarmTransitionError';
  }
}

export function openAlarm(input: {
  id: string;
  tenantId: string;
  ruleId: string;
  ruleVersion: number;
  deviceId: string;
  severity: Severity;
  occurredAt: Date;
  now: Date;
}): Alarm {
  const { now, ...rest } = input;
  return {
    ...rest,
    state: 'ATIVO',
    openedAt: now,
    events: [{ type: 'aberto', at: now, measuredAt: input.occurredAt }],
  };
}

function requireOpen(alarm: Alarm, allowed: AlarmState[]): void {
  if (!allowed.includes(alarm.state))
    throw new AlarmTransitionError(`o alarme já está ${alarm.state}`);
}

export function acknowledgeAlarm(
  alarm: Alarm,
  actor: string,
  note: string | undefined,
  now: Date,
): Alarm {
  requireOpen(alarm, ['ATIVO']);
  return {
    ...alarm,
    state: 'RECONHECIDO',
    acknowledgedAt: now,
    acknowledgedBy: actor,
    ...(note !== undefined ? { acknowledgeNote: note } : {}),
    events: [
      ...alarm.events,
      { type: 'reconhecido', at: now, actor, ...(note !== undefined ? { note } : {}) },
    ],
  };
}

export function resolveAlarmManually(
  alarm: Alarm,
  actor: string,
  reason: string,
  now: Date,
): Alarm {
  requireOpen(alarm, ['ATIVO', 'RECONHECIDO']);
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new AlarmTransitionError('a resolução manual exige motivo');
  return {
    ...alarm,
    state: 'RESOLVIDO',
    resolution: 'manual',
    resolvedAt: now,
    resolvedBy: actor,
    resolveReason: trimmed,
    events: [...alarm.events, { type: 'resolvido', at: now, actor, reason: trimmed }],
  };
}

export function resolveAlarmAutomatically(alarm: Alarm, measuredAt: Date, now: Date): Alarm {
  requireOpen(alarm, ['ATIVO', 'RECONHECIDO']);
  return {
    ...alarm,
    state: 'RESOLVIDO',
    resolution: 'automatica',
    resolvedAt: now,
    events: [...alarm.events, { type: 'resolvido', at: now, measuredAt }],
  };
}
