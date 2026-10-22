import type {
  AbsenceState,
  Condition,
  Duration,
  Operator,
  PairState,
  RuleEffect,
  RulePoint,
} from './model';
import { linearSlopePerMinute } from './regression';

export function initialPairState(): PairState {
  return {
    lastTs: null,
    window: [],
    enter: { since: null, count: 0 },
    exit: { since: null, count: 0 },
    open: false,
  };
}

export function compare(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '==':
      return value === threshold;
    case '!=':
      return value !== threshold;
  }
}

// Sem duração, basta uma leitura. Com leituras e segundos, valem os dois.
function durationMet(
  count: number,
  since: number,
  t: number,
  duration: Duration | undefined,
): boolean {
  const readings = duration?.readings ?? (duration?.seconds === undefined ? 1 : 0);
  const seconds = duration?.seconds ?? 0;
  return count >= readings && t - since >= seconds * 1000;
}

function entryMet(
  condition: Condition,
  point: RulePoint,
  window: { t: number; v: number }[],
): boolean {
  if (condition.operator !== undefined && condition.threshold !== undefined) {
    if (!compare(point.v, condition.operator, condition.threshold)) return false;
  }
  if (condition.rate) {
    if (window.length < condition.rate.minPoints) return false;
    if (!compare(linearSlopePerMinute(window), condition.rate.operator, condition.rate.threshold))
      return false;
  }
  return true;
}

const RESET = { since: null, count: 0 };

// Avalia um ponto na ordem do horário da medição. Ponto atrasado, repetido ou anterior ao último
// processado não muda o estado (continua na série); é o mesmo objeto de estado que volta.
export function evaluatePoint(
  condition: Condition,
  state: PairState,
  point: RulePoint,
): { state: PairState; effect: RuleEffect | null } {
  if (point.late || (state.lastTs !== null && point.t <= state.lastTs))
    return { state, effect: null };

  const window = condition.rate
    ? [...state.window, { t: point.t, v: point.v }].filter(
        (p) => p.t >= point.t - condition.rate!.windowS * 1000,
      )
    : [];
  const entered = entryMet(condition, point, window);
  const base = { ...state, lastTs: point.t, window };

  if (!state.open) {
    if (!entered) return { state: { ...base, enter: RESET }, effect: null };
    const enter = { since: state.enter.since ?? point.t, count: state.enter.count + 1 };
    if (!durationMet(enter.count, enter.since, point.t, condition.duration)) {
      return { state: { ...base, enter }, effect: null };
    }
    return {
      state: { ...base, enter: RESET, exit: RESET, open: true },
      effect: { type: 'open', occurredAt: point.t },
    };
  }

  // Alarme aberto: a saída tem limiar e duração próprios (histerese). Sem saída configurada,
  // sair da condição de entrada basta.
  const exited = condition.exit
    ? compare(point.v, condition.exit.operator, condition.exit.threshold)
    : !entered;
  if (!exited) return { state: { ...base, exit: RESET }, effect: null };
  const exit = { since: state.exit.since ?? point.t, count: state.exit.count + 1 };
  if (!durationMet(exit.count, exit.since, point.t, condition.exit?.duration)) {
    return { state: { ...base, exit }, effect: null };
  }
  return {
    state: { ...base, enter: RESET, exit: RESET, open: false },
    effect: { type: 'resolve', occurredAt: point.t },
  };
}

// Depois de uma resolução manual, o par volta a contar do zero.
export function afterManualResolution(state: PairState): PairState {
  return { ...state, enter: RESET, exit: RESET, open: false };
}

// Ausência (varredura periódica): mais de N intervalos esperados sem contato. Avisa uma vez por
// período de ausência; um contato novo abre um novo período.
export function evaluateAbsence(
  absence: { intervals: number },
  state: AbsenceState,
  lastContactAt: Date | null,
  expectedIntervalS: number,
  now: Date,
): { state: AbsenceState; effect: { type: 'absent'; lastContactAt: number } | null } {
  if (lastContactAt === null) return { state, effect: null };
  const contact = lastContactAt.getTime();
  const silent = now.getTime() - contact > absence.intervals * expectedIntervalS * 1000;
  if (!silent || state.notifiedFor === contact) return { state, effect: null };
  return { state: { notifiedFor: contact }, effect: { type: 'absent', lastContactAt: contact } };
}
