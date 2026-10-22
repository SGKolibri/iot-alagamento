import type { ClockPort } from '../ports/clock.port';
import type { BatchOutcome, Issue, MessageOutcome, Principal, TopicAddress } from './model';
import type {
  DeadLetterPort,
  DeduplicationPort,
  DeviceDirectoryPort,
  EventBusPort,
  LoggerPort,
  MeasurementRepositoryPort,
  SchemaValidatorPort,
} from './ports';
import { AuthenticateStep } from './steps/authenticate.step';
import { DeadLetterStep } from './steps/dead-letter.step';
import { DeduplicateStep } from './steps/deduplicate.step';
import { EnrichStep } from './steps/enrich.step';
import { OrderStep } from './steps/order.step';
import { PublishStep } from './steps/publish.step';
import { ValidateStep } from './steps/validate.step';
import { field, type IngestionStep, type PipelineContext, type PipelineItem } from './steps/step';

export interface IngestionDependencies {
  clock: ClockPort;
  validator: SchemaValidatorPort;
  deduplication: DeduplicationPort;
  measurements: MeasurementRepositoryPort;
  deadLetters: DeadLetterPort;
  eventBus: EventBusPort;
  directory: DeviceDirectoryPort;
  logger: LoggerPort;
}

export type MessageRequest =
  | { source: 'mqtt'; topic: TopicAddress; body: unknown }
  | { source: 'http'; credential?: string; body: unknown };

export interface BatchRequest {
  credential?: string;
  body: unknown;
}

const UNAUTHORIZED: Issue = {
  path: '',
  rule: 'credencial',
  message: 'credencial ausente ou inválida',
};

// Os erros de cada mensagem do lote ficam em /mensagens/N; o resto invalida o lote inteiro.
const MESSAGE_PATH = /^\/mensagens\/\d+(\/|$)/;

// Pipeline de ingestão (Pipes and Filters): Autenticar, Validar, Deduplicar, Ordenar,
// Enriquecer e Publicar, mais o Dead Letter Channel no fim. Receber fica nos adaptadores.
export class IngestionPipeline {
  private readonly authenticate: AuthenticateStep;
  private readonly steps: IngestionStep[];

  constructor(private readonly deps: IngestionDependencies) {
    this.authenticate = new AuthenticateStep(deps.directory);
    this.steps = [
      this.authenticate,
      new ValidateStep(deps.validator),
      new DeduplicateStep(deps.deduplication),
      new OrderStep(deps.clock),
      new EnrichStep(),
      new PublishStep(deps.measurements, deps.eventBus, deps.deduplication),
      new DeadLetterStep(deps.deadLetters),
    ];
  }

  async ingestMessage(request: MessageRequest): Promise<MessageOutcome> {
    const context: PipelineContext = { source: request.source, receivedAt: this.deps.clock.now() };
    if (request.source === 'mqtt') {
      // No MQTT o broker já autenticou a conexão; o tópico identifica o dispositivo.
      context.topic = request.topic;
    } else {
      const principal = await this.authenticate.resolvePrincipal(request.credential);
      if (!principal) return this.unauthorized(context);
      context.principal = principal;
    }
    const [item] = await this.process([request.body], context);
    return toOutcome(item!);
  }

  async ingestBatch(request: BatchRequest): Promise<BatchOutcome> {
    const context: PipelineContext = { source: 'batch', receivedAt: this.deps.clock.now() };
    const principal = await this.authenticate.resolvePrincipal(request.credential);
    if (!principal) {
      this.deps.logger.warn({ origem: 'batch' }, 'lote sem credencial válida');
      return { status: 'unauthorized' };
    }
    context.principal = principal;

    const envelopeIssues = this.deps.validator
      .validateBatch(request.body)
      .filter((issue) => !MESSAGE_PATH.test(issue.path));
    if (envelopeIssues.length > 0) {
      this.deps.logger.warn(
        { origem: 'batch', id_lote: field(request.body, 'id_lote'), erros: envelopeIssues },
        'lote recusado inteiro',
      );
      return { status: 'rejected', issues: envelopeIssues };
    }

    const body = request.body as { id_lote: string; mensagens: unknown[] };
    const items = await this.process(body.mensagens, context);
    return { status: 'processed', batchId: body.id_lote, results: items.map(toOutcome) };
  }

  // Devolve os itens na ordem de chegada, embora as etapas possam reordená-los.
  private async process(bodies: unknown[], context: PipelineContext): Promise<PipelineItem[]> {
    const items = bodies.map((raw, index) => this.createItem(raw, index, context));
    let current = items;
    for (const step of this.steps) current = await step.run(current, context);
    return items;
  }

  private createItem(raw: unknown, index: number, context: PipelineContext): PipelineItem {
    const logger = this.deps.logger.child({
      id_mensagem: field(raw, 'id_mensagem') ?? null,
      origem: context.source,
    });
    logger.debug(
      { dispositivo: field(raw, 'dispositivo'), principal: context.principal?.kind ?? 'broker' },
      'mensagem recebida',
    );
    return { index, raw, status: 'pending', issues: [], logger, late: false, measurements: [] };
  }

  private unauthorized(context: PipelineContext): MessageOutcome {
    this.deps.logger.warn({ origem: context.source }, 'mensagem sem credencial válida');
    return { status: 'unauthorized', issues: [UNAUTHORIZED], measurements: [] };
  }
}

function toOutcome(item: PipelineItem): MessageOutcome {
  return {
    status: item.status === 'pending' ? 'refused' : item.status,
    messageId: field(item.raw, 'id_mensagem'),
    issues: item.issues,
    late: item.late,
    location: item.location,
    measurements: item.measurements,
  };
}
