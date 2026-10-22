import type {
  DeadLetter,
  DeviceRecord,
  IngestionEvent,
  Issue,
  Measurement,
  Principal,
} from './model';

// Valida contra o JSON Schema da versão declarada na mensagem.
export interface SchemaValidatorPort {
  validateMessage(data: unknown): Issue[];
  validateBatch(data: unknown): Issue[];
}

export interface DeduplicationPort {
  findSeen(tenantId: string, messageIds: string[]): Promise<Set<string>>;
  remember(tenantId: string, messageIds: string[]): Promise<void>;
}

// Gravação idempotente: a mesma medição gravada duas vezes não duplica.
export interface MeasurementRepositoryPort {
  saveAll(measurements: Measurement[]): Promise<void>;
}

export interface DeadLetterPort {
  saveAll(letters: DeadLetter[]): Promise<void>;
}

export interface DeviceDirectoryPort {
  findDevice(tenantSlug: string, deviceSlug: string): Promise<DeviceRecord | null>;
  authenticate(credential: string): Promise<Principal | null>;
}

export interface EventBusPort {
  publishAll(events: IngestionEvent[]): Promise<void>;
}

export interface LoggerPort {
  child(bindings: Record<string, unknown>): LoggerPort;
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
