import {
  AlarmTransitionError,
  acknowledgeAlarm,
  afterManualResolution,
  evaluatePoint,
  initialPairState,
  openAlarm,
  resolveAlarmAutomatically,
  resolveAlarmManually,
  type Condition,
} from '../../src';

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);
const base = {
  id: 'alarm-1',
  tenantId: 'tenant-a',
  ruleId: 'rule-a',
  ruleVersion: 2,
  deviceId: 'device-a',
  severity: 'alta' as const,
};

describe('6. ciclo do alarme', () => {
  it('um alarme aberto por par regra e dispositivo: leituras seguidas acima do limite não reabrem', () => {
    const condition: Condition = { quantity: 'level', operator: '>', threshold: 10 };
    let state = initialPairState();
    const opens: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = evaluatePoint(condition, state, { t: T0 + i * 1000, v: 20, late: false });
      state = result.state;
      if (result.effect?.type === 'open') opens.push(i);
    }
    expect(opens).toEqual([0]);
  });

  it('abre ATIVO com ocorridoEm (medição), abertoEm (agora) e o evento na linha do tempo', () => {
    const alarm = openAlarm({ ...base, occurredAt: new Date(T0), now: new Date(T0 + 1500) });
    expect(alarm).toEqual({
      ...base,
      state: 'ATIVO',
      occurredAt: new Date(T0),
      openedAt: new Date(T0 + 1500),
      events: [{ type: 'aberto', at: new Date(T0 + 1500), measuredAt: new Date(T0) }],
    });
  });

  it('o reconhecimento registra autor e nota; a resolução manual, autor e motivo', () => {
    const opened = openAlarm({ ...base, occurredAt: new Date(T0), now: new Date(T0) });
    const acked = acknowledgeAlarm(opened, 'operador-1', 'equipe a caminho', new Date(T0 + 60_000));
    expect(acked).toMatchObject({
      state: 'RECONHECIDO',
      acknowledgedAt: new Date(T0 + 60_000),
      acknowledgedBy: 'operador-1',
      acknowledgeNote: 'equipe a caminho',
    });
    const resolved = resolveAlarmManually(
      acked,
      'gestor-1',
      '  sensor em manutenção  ',
      new Date(T0 + 120_000),
    );
    expect(resolved).toMatchObject({
      state: 'RESOLVIDO',
      resolution: 'manual',
      resolvedBy: 'gestor-1',
      resolveReason: 'sensor em manutenção',
      resolvedAt: new Date(T0 + 120_000),
    });
    expect(resolved.events.map((e) => e.type)).toEqual(['aberto', 'reconhecido', 'resolvido']);
    expect(resolved.events[2]).toEqual({
      type: 'resolvido',
      at: new Date(T0 + 120_000),
      actor: 'gestor-1',
      reason: 'sensor em manutenção',
    });
    expect(opened.state).toBe('ATIVO');
  });

  it('reconhecer sem nota é permitido', () => {
    const acked = acknowledgeAlarm(
      openAlarm({ ...base, occurredAt: new Date(T0), now: new Date(T0) }),
      'op',
      undefined,
      new Date(T0),
    );
    expect(acked.events[1]).toEqual({ type: 'reconhecido', at: new Date(T0), actor: 'op' });
  });

  it('a resolução automática registra o horário da medição de saída', () => {
    const resolved = resolveAlarmAutomatically(
      openAlarm({ ...base, occurredAt: new Date(T0), now: new Date(T0) }),
      new Date(T0 + 600_000),
      new Date(T0 + 601_000),
    );
    expect(resolved).toMatchObject({
      state: 'RESOLVIDO',
      resolution: 'automatica',
      resolvedAt: new Date(T0 + 601_000),
    });
    expect(resolved.events.at(-1)).toEqual({
      type: 'resolvido',
      at: new Date(T0 + 601_000),
      measuredAt: new Date(T0 + 600_000),
    });
  });

  it('transições inválidas são recusadas com motivo', () => {
    const opened = openAlarm({ ...base, occurredAt: new Date(T0), now: new Date(T0) });
    const acked = acknowledgeAlarm(opened, 'op', undefined, new Date(T0));
    const resolved = resolveAlarmManually(acked, 'op', 'ok', new Date(T0));
    expect(() => acknowledgeAlarm(acked, 'op', undefined, new Date(T0))).toThrow(
      new AlarmTransitionError('o alarme já está RECONHECIDO'),
    );
    expect(() => acknowledgeAlarm(resolved, 'op', undefined, new Date(T0))).toThrow(
      'o alarme já está RESOLVIDO',
    );
    expect(() => resolveAlarmManually(resolved, 'op', 'x', new Date(T0))).toThrow(
      'o alarme já está RESOLVIDO',
    );
    expect(() => resolveAlarmAutomatically(resolved, new Date(T0), new Date(T0))).toThrow(
      'o alarme já está RESOLVIDO',
    );
    expect(() => resolveAlarmManually(opened, 'op', '   ', new Date(T0))).toThrow(
      'a resolução manual exige motivo',
    );
    expect(new AlarmTransitionError('x').name).toBe('AlarmTransitionError');
  });

  it('depois da resolução manual o par volta a contar do zero e pode abrir de novo', () => {
    const condition: Condition = {
      quantity: 'level',
      operator: '>',
      threshold: 10,
      duration: { readings: 2 },
    };
    let state = initialPairState();
    for (const i of [0, 1])
      state = evaluatePoint(condition, state, { t: T0 + i * 1000, v: 20, late: false }).state;
    expect(state.open).toBe(true);
    state = afterManualResolution(state);
    expect(state).toMatchObject({
      open: false,
      enter: { since: null, count: 0 },
      exit: { since: null, count: 0 },
    });
    state = evaluatePoint(condition, state, { t: T0 + 2000, v: 20, late: false }).state;
    const reopened = evaluatePoint(condition, state, { t: T0 + 3000, v: 20, late: false });
    expect(reopened.effect).toEqual({ type: 'open', occurredAt: T0 + 3000 });
  });
});
