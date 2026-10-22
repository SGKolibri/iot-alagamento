// Motor de regras (PRD, seção 12; ADR-020). Neutro quanto ao cenário: grandezas e limites são
// configuração. Os nomes em português do contrato viram estes tipos no adaptador.

export type Operator = '>' | '>=' | '<' | '<=' | '==' | '!=';
export type Severity = 'baixa' | 'media' | 'alta' | 'critica';

export interface Duration {
  readings?: number;
  seconds?: number;
}

export interface Condition {
  quantity?: string;
  operator?: Operator;
  threshold?: number;
  duration?: Duration;
  rate?: { operator: Operator; threshold: number; windowS: number; minPoints: number };
  exit?: { operator: Operator; threshold: number; duration?: Duration };
  areaId?: string | null;
  absence?: { intervals: number };
}

export type Action =
  | { type: 'alarm'; severity: Severity }
  | { type: 'notify'; channels: string[]; suppressionS?: number }
  | { type: 'webhook'; url: string; timeoutMs?: number }
  | { type: 'topic'; topic: string }
  | { type: 'command'; name: string; parameters?: Record<string, unknown> };

export interface RuleDefinition {
  id: string;
  tenantId: string;
  name: string;
  scope: 'central' | 'borda';
  active: boolean;
  version: number;
  condition: Condition;
  actions: Action[];
}

// Ponto avaliado: horário da medição (ms), valor e se chegou atrasado.
export interface RulePoint {
  t: number;
  v: number;
  late: boolean;
}

interface Streak {
  since: number | null;
  count: number;
}

// Estado por par regra e dispositivo, guardado atrás de RuleStatePort.
export interface PairState {
  lastTs: number | null;
  window: { t: number; v: number }[];
  enter: Streak;
  exit: Streak;
  open: boolean;
}

export type RuleEffect =
  { type: 'open'; occurredAt: number } | { type: 'resolve'; occurredAt: number };

export interface AbsenceState {
  // Último contato para o qual a ausência já foi avisada (um aviso por período de ausência).
  notifiedFor: number | null;
}
