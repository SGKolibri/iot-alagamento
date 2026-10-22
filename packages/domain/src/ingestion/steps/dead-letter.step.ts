import type { DeadLetterPort } from '../ports';
import {
  field,
  topicToString,
  type IngestionStep,
  type PipelineContext,
  type PipelineItem,
} from './step';

// Dead Letter Channel: toda mensagem recusada é guardada com o motivo.
export class DeadLetterStep implements IngestionStep {
  readonly name = 'dlq';
  constructor(private readonly deadLetters: DeadLetterPort) {}

  async run(items: PipelineItem[], context: PipelineContext): Promise<PipelineItem[]> {
    const refused = items.filter((item) => item.status === 'refused');
    if (refused.length === 0) return items;
    await this.deadLetters.saveAll(
      refused.map((item) => ({
        tenantId: item.device?.tenantId,
        messageId: field(item.raw, 'id_mensagem'),
        source: context.source,
        topic: context.topic ? topicToString(context.topic) : undefined,
        payload: item.raw,
        issues: item.issues,
        receivedAt: context.receivedAt,
      })),
    );
    return items;
  }
}
