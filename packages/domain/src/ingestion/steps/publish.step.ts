import type { IngestionEvent } from '../model';
import type { DeduplicationPort, EventBusPort, MeasurementRepositoryPort } from '../ports';
import { pending, type IngestionStep, type PipelineContext, type PipelineItem } from './step';

// Grava as medições na série, publica os eventos no barramento e só então registra os
// id_mensagem como vistos. Se algo falhar no meio, o reenvio regrava sem duplicar (chave
// idempotente) e pode republicar o evento, mas nenhuma mensagem se perde.
export class PublishStep implements IngestionStep {
  readonly name = 'publicar';
  constructor(
    private readonly repository: MeasurementRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly deduplication: DeduplicationPort,
  ) {}

  async run(items: PipelineItem[], context: PipelineContext): Promise<PipelineItem[]> {
    const accepted = pending(items);
    if (accepted.length === 0) return items;

    const measurements = accepted.flatMap((item) => item.measurements);
    if (measurements.length > 0) await this.repository.saveAll(measurements);
    await this.eventBus.publishAll(accepted.flatMap((item) => this.events(item, context)));

    const byTenant = new Map<string, string[]>();
    for (const item of accepted) {
      const tenant = item.device!.tenantId;
      byTenant.set(tenant, [...(byTenant.get(tenant) ?? []), item.message!.id_mensagem]);
    }
    for (const [tenant, ids] of byTenant) await this.deduplication.remember(tenant, ids);

    for (const item of accepted) {
      item.status = 'accepted';
      item.logger.info(
        { etapa: this.name, medidas: item.measurements.length, atrasada: item.late },
        'mensagem aceita',
      );
    }
    return items;
  }

  private events(item: PipelineItem, context: PipelineContext): IngestionEvent[] {
    const message = item.message!;
    const device = item.device!;
    const base = {
      tenantId: device.tenantId,
      deviceId: device.id,
      deviceSlug: device.slug,
      messageId: message.id_mensagem,
      timestamp: item.timestamp!.toISOString(),
      receivedAt: context.receivedAt.toISOString(),
      late: item.late,
      via: message.via,
      location: item.location,
    };
    const events: IngestionEvent[] = [];
    if (item.measurements.length > 0) {
      events.push({
        ...base,
        type: 'measurement.ingested',
        measurements: item.measurements.map(({ quantity, value, unit, suspect, derived }) => ({
          quantity,
          value,
          unit,
          suspect,
          derived,
        })),
      });
    }
    if (message.tipo === 'evento' && message.evento) {
      events.push({ ...base, type: 'device.event.received', event: message.evento });
    }
    if (message.tipo === 'estado' && message.estado) {
      events.push({ ...base, type: 'device.state.reported', state: message.estado });
    }
    return events;
  }
}
