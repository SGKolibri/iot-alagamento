import { randomUUID } from 'node:crypto';

export interface PublisherOptions {
  tenant: string;
  site: string;
  domain: string;
  device: string;
  quantity: string;
  unit: string;
  initialValue: number;
  step: number;
  count: number;
  intervalMs: number;
  start: Date;
  // Posições (a partir de 0) que saem sem o campo versao, para exercitar a DLQ.
  invalidAt?: number[];
}

export interface TelemetryMessage {
  versao?: string;
  id_mensagem: string;
  dispositivo: string;
  tipo: 'telemetria';
  timestamp: string;
  medidas: { grandeza: string; valor: number; unidade: string }[];
}

export interface Batch {
  versao: '1.0';
  id_lote: string;
  origem: string;
  mensagens: TelemetryMessage[];
}

export function buildMessages(options: PublisherOptions): TelemetryMessage[] {
  const invalid = new Set(options.invalidAt ?? []);
  return Array.from({ length: options.count }, (_, i) => {
    const message: TelemetryMessage = {
      versao: '1.0',
      id_mensagem: randomUUID(),
      dispositivo: options.device,
      tipo: 'telemetria',
      timestamp: new Date(options.start.getTime() + i * options.intervalMs).toISOString(),
      medidas: [
        {
          grandeza: options.quantity,
          valor: Number((options.initialValue + i * options.step).toFixed(6)),
          unidade: options.unit,
        },
      ],
    };
    if (invalid.has(i)) delete message.versao;
    return message;
  });
}

export function buildBatch(messages: TelemetryMessage[], origin: string): Batch {
  return { versao: '1.0', id_lote: randomUUID(), origem: origin, mensagens: messages };
}

export function topicFor(
  options: Pick<PublisherOptions, 'tenant' | 'site' | 'domain' | 'device'>,
): string {
  return [options.tenant, options.site, options.domain, options.device, 'telemetria'].join('/');
}
