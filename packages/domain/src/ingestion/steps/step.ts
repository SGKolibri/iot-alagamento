import type {
  CanonicalMessage,
  DeviceRecord,
  IngestionSource,
  Issue,
  Location,
  Measurement,
  OutcomeStatus,
  Principal,
  TopicAddress,
} from '../model';
import type { LoggerPort } from '../ports';

// Uma mensagem em trânsito pelo pipeline (Pipes and Filters).
export interface PipelineItem {
  index: number;
  raw: unknown;
  status: OutcomeStatus | 'pending';
  issues: Issue[];
  logger: LoggerPort;
  message?: CanonicalMessage;
  device?: DeviceRecord;
  timestamp?: Date;
  late: boolean;
  location?: Location;
  measurements: Measurement[];
}

export interface PipelineContext {
  source: IngestionSource;
  topic?: TopicAddress;
  principal?: Principal;
  receivedAt: Date;
}

// Cada etapa recebe os itens e devolve os itens, possivelmente reordenados.
// Só trabalha nos itens pendentes; os recusados ou duplicados passam adiante intactos.
export interface IngestionStep {
  readonly name: string;
  run(items: PipelineItem[], context: PipelineContext): Promise<PipelineItem[]>;
}

export function pending(items: PipelineItem[]): PipelineItem[] {
  return items.filter((item) => item.status === 'pending');
}

export function refuse(item: PipelineItem, step: string, issues: Issue[]): void {
  item.status = 'refused';
  item.issues.push(...issues);
  item.logger.warn({ etapa: step, erros: issues }, 'mensagem recusada');
}

export function field(raw: unknown, name: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = (raw as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

export function topicToString(topic: TopicAddress): string {
  return [topic.tenant, topic.site, topic.domain, topic.device, topic.kind].join('/');
}
