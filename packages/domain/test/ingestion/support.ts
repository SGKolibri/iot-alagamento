import type {
  ClockPort,
  DeadLetter,
  DeadLetterPort,
  DeduplicationPort,
  DeviceDirectoryPort,
  DeviceRecord,
  EventBusPort,
  IngestionEvent,
  Issue,
  LoggerPort,
  Measurement,
  MeasurementRepositoryPort,
  Principal,
  SchemaValidatorPort,
} from '../../src';
import { IngestionPipeline } from '../../src';

export const NOW = new Date('2026-10-25T12:00:00Z');

export class FixedClock implements ClockPort {
  constructor(public current: Date = NOW) {}
  now(): Date {
    return this.current;
  }
}

// Validador falso: aceita objetos com versao "1.0" e id_mensagem; o adaptador real usa Ajv.
export class FakeSchemaValidator implements SchemaValidatorPort {
  messageRule: (data: unknown) => Issue[] = (data) => {
    if (typeof data !== 'object' || data === null) {
      return [{ path: '', rule: 'type', message: 'a mensagem precisa ser um objeto' }];
    }
    const issues: Issue[] = [];
    const body = data as Record<string, unknown>;
    if (body.versao !== '1.0') {
      issues.push({ path: '/versao', rule: 'required', message: 'campo obrigatório: versao' });
    }
    if (typeof body.id_mensagem !== 'string') {
      issues.push({ path: '/id_mensagem', rule: 'required', message: 'campo obrigatório' });
    }
    return issues;
  };
  batchRule: (data: unknown) => Issue[] = () => [];

  validateMessage(data: unknown): Issue[] {
    return this.messageRule(data);
  }
  validateBatch(data: unknown): Issue[] {
    return this.batchRule(data);
  }
}

export class MemoryDeduplication implements DeduplicationPort {
  readonly seen = new Set<string>();
  async findSeen(tenantId: string, ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.seen.has(`${tenantId}:${id}`)));
  }
  async remember(tenantId: string, ids: string[]): Promise<void> {
    for (const id of ids) this.seen.add(`${tenantId}:${id}`);
  }
}

// Repositório falso com a mesma chave idempotente da hipertabela: (dispositivo, grandeza, horário).
export class MemoryMeasurements implements MeasurementRepositoryPort {
  readonly rows: Measurement[] = [];
  readonly calls: Measurement[][] = [];
  async saveAll(measurements: Measurement[]): Promise<void> {
    this.calls.push(measurements);
    for (const m of measurements) {
      const exists = this.rows.some(
        (r) =>
          r.deviceId === m.deviceId &&
          r.quantity === m.quantity &&
          r.timestamp.getTime() === m.timestamp.getTime(),
      );
      if (!exists) this.rows.push(m);
    }
  }
}

export class MemoryDeadLetters implements DeadLetterPort {
  readonly letters: DeadLetter[] = [];
  async saveAll(letters: DeadLetter[]): Promise<void> {
    this.letters.push(...letters);
  }
}

export class MemoryEventBus implements EventBusPort {
  readonly events: IngestionEvent[] = [];
  async publishAll(events: IngestionEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

export interface LogRecord {
  level: string;
  bindings: Record<string, unknown>;
  fields: Record<string, unknown>;
  message: string;
}

export class MemoryLogger implements LoggerPort {
  constructor(
    readonly records: LogRecord[] = [],
    private readonly bindings: Record<string, unknown> = {},
  ) {}
  child(bindings: Record<string, unknown>): LoggerPort {
    return new MemoryLogger(this.records, { ...this.bindings, ...bindings });
  }
  private write(level: string, fields: Record<string, unknown>, message: string): void {
    this.records.push({ level, bindings: this.bindings, fields, message });
  }
  debug(fields: Record<string, unknown>, message: string): void {
    this.write('debug', fields, message);
  }
  info(fields: Record<string, unknown>, message: string): void {
    this.write('info', fields, message);
  }
  warn(fields: Record<string, unknown>, message: string): void {
    this.write('warn', fields, message);
  }
  error(fields: Record<string, unknown>, message: string): void {
    this.write('error', fields, message);
  }
}

export const TENANT_ID = '11111111-1111-4111-8111-111111111111';

export function waterLevelDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'nivel-01',
    tenantId: TENANT_ID,
    tenantSlug: 'inquilino-a',
    site: 'site-a',
    domain: 'dominio-a',
    location: {
      site: 'site-a',
      area: 'area-a',
      geo: { type: 'Point', coordinates: [-48.95, -16.32] },
    },
    attributes: { altura_instalacao_cm: 300 },
    profile: {
      expectedIntervalSeconds: 60,
      quantities: [
        { name: 'distancia_agua', unit: 'cm', range: { min: 0, max: 400 } },
        {
          name: 'nivel_agua',
          unit: 'cm',
          expression: 'atributos.altura_instalacao_cm - distancia_agua',
        },
        { name: 'bateria', unit: 'mV', range: { min: 2500, max: 4500 } },
      ],
    },
    ...overrides,
  };
}

export class MemoryDirectory implements DeviceDirectoryPort {
  readonly devices: DeviceRecord[] = [waterLevelDevice()];
  readonly credentials = new Map<string, Principal>([
    ['token-nivel-01', { kind: 'device', tenantSlug: 'inquilino-a', deviceSlug: 'nivel-01' }],
    ['token-borda', { kind: 'edge', tenantSlug: 'inquilino-a', nodeId: 'borda-01' }],
  ]);
  async findDevice(tenantSlug: string, deviceSlug: string): Promise<DeviceRecord | null> {
    return this.devices.find((d) => d.tenantSlug === tenantSlug && d.slug === deviceSlug) ?? null;
  }
  async authenticate(credential: string): Promise<Principal | null> {
    return this.credentials.get(credential) ?? null;
  }
}

export function setup() {
  const ports = {
    clock: new FixedClock(),
    validator: new FakeSchemaValidator(),
    deduplication: new MemoryDeduplication(),
    measurements: new MemoryMeasurements(),
    deadLetters: new MemoryDeadLetters(),
    eventBus: new MemoryEventBus(),
    directory: new MemoryDirectory(),
    logger: new MemoryLogger(),
  };
  return { ...ports, pipeline: new IngestionPipeline(ports) };
}

let counter = 0;
export function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
}

export function telemetry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    versao: '1.0',
    id_mensagem: nextId(),
    dispositivo: 'nivel-01',
    tipo: 'telemetria',
    timestamp: '2026-10-25T11:59:00Z',
    medidas: [
      { grandeza: 'distancia_agua', valor: 120, unidade: 'cm' },
      { grandeza: 'bateria', valor: 3900, unidade: 'mV' },
    ],
    ...overrides,
  };
}

export const TOPIC = {
  tenant: 'inquilino-a',
  site: 'site-a',
  domain: 'dominio-a',
  device: 'nivel-01',
  kind: 'telemetria',
};
