// Tipos do pipeline de ingestão. Os campos da mensagem canônica ficam em português,
// exatamente como no contrato (docs/contracts/canonical-message.v1.schema.json).

export interface CanonicalMeasure {
  grandeza: string;
  valor: number;
  unidade: string;
}

export interface Location {
  site?: string;
  area?: string;
  geo?: unknown;
}

export interface CanonicalMessage {
  versao: string;
  id_mensagem: string;
  dispositivo: string;
  tipo: 'telemetria' | 'evento' | 'estado' | 'comando';
  timestamp: string;
  via?: string;
  local?: Location;
  medidas?: CanonicalMeasure[];
  evento?: { codigo: string; descricao?: string; dados?: Record<string, unknown> };
  estado?: Record<string, unknown>;
  comando?: { nome: string; parametros?: Record<string, unknown> };
}

export interface Issue {
  path: string;
  rule: string;
  message: string;
}

export interface QuantitySpec {
  name: string;
  unit: string;
  range?: { min?: number; max?: number };
  expression?: string;
}

export interface DeviceProfile {
  expectedIntervalSeconds: number;
  quantities: QuantitySpec[];
}

export interface DeviceRecord {
  id: string;
  slug: string;
  tenantId: string;
  tenantSlug: string;
  site: string;
  domain: string;
  location?: Location;
  attributes: Record<string, number>;
  profile: DeviceProfile;
}

export type Principal =
  | { kind: 'device'; tenantSlug: string; deviceSlug: string }
  | { kind: 'edge'; tenantSlug: string; nodeId: string };

export interface TopicAddress {
  tenant: string;
  site: string;
  domain: string;
  device: string;
  kind: string;
}

export interface Measurement {
  tenantId: string;
  deviceId: string;
  quantity: string;
  timestamp: Date;
  value: number;
  unit: string;
  suspect: boolean;
  late: boolean;
  derived: boolean;
  messageId: string;
  receivedAt: Date;
}

export interface DeadLetter {
  tenantId?: string;
  messageId?: string;
  source: IngestionSource;
  topic?: string;
  payload: unknown;
  issues: Issue[];
  receivedAt: Date;
}

interface EventBase {
  tenantId: string;
  deviceId: string;
  deviceSlug: string;
  messageId: string;
  timestamp: string;
  receivedAt: string;
  late: boolean;
  via?: string;
  location?: Location;
}

export type IngestionEvent =
  | (EventBase & {
      type: 'measurement.ingested';
      measurements: Pick<Measurement, 'quantity' | 'value' | 'unit' | 'suspect' | 'derived'>[];
    })
  | (EventBase & { type: 'device.event.received'; event: NonNullable<CanonicalMessage['evento']> })
  | (EventBase & { type: 'device.state.reported'; state: Record<string, unknown> });

export type IngestionSource = 'mqtt' | 'http' | 'batch';

export type OutcomeStatus = 'accepted' | 'duplicate' | 'refused';

export interface MessageOutcome {
  status: OutcomeStatus | 'unauthorized';
  messageId?: string;
  issues: Issue[];
  late?: boolean;
  location?: Location;
  measurements: Measurement[];
}

export type BatchOutcome =
  | { status: 'processed'; batchId: string; results: MessageOutcome[] }
  | { status: 'rejected'; issues: Issue[] }
  | { status: 'unauthorized' };
