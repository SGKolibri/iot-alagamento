import type { DeduplicationPort } from '../ports';
import { pending, type IngestionStep, type PipelineItem } from './step';

// Idempotent Receiver: id_mensagem já visto (antes ou no mesmo lote) é descartado sem erro.
export class DeduplicateStep implements IngestionStep {
  readonly name = 'deduplicar';
  constructor(private readonly deduplication: DeduplicationPort) {}

  async run(items: PipelineItem[]): Promise<PipelineItem[]> {
    const byTenant = new Map<string, PipelineItem[]>();
    for (const item of pending(items)) {
      const tenant = item.device!.tenantId;
      byTenant.set(tenant, [...(byTenant.get(tenant) ?? []), item]);
    }
    for (const [tenant, group] of byTenant) {
      const ids = group.map((item) => item.message!.id_mensagem);
      const seen = await this.deduplication.findSeen(tenant, ids);
      for (const item of group) {
        const id = item.message!.id_mensagem;
        if (seen.has(id)) {
          item.status = 'duplicate';
          item.logger.info({ etapa: this.name }, 'mensagem duplicada descartada');
        }
        seen.add(id);
      }
    }
    return items;
  }
}
