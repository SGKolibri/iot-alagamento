import type { ClockPort } from '../../ports/clock.port';
import { pending, type IngestionStep, type PipelineItem } from './step';

export const LATE_AFTER_INTERVALS = 3;

// Ordena pelo horário da medição e marca como atrasada a mensagem mais antiga que
// 3 intervalos esperados do perfil (RF-ING-04).
export class OrderStep implements IngestionStep {
  readonly name = 'ordenar';
  constructor(private readonly clock: ClockPort) {}

  async run(items: PipelineItem[]): Promise<PipelineItem[]> {
    const now = this.clock.now().getTime();
    for (const item of pending(items)) {
      const limitMs = LATE_AFTER_INTERVALS * item.device!.profile.expectedIntervalSeconds * 1000;
      item.late = now - item.timestamp!.getTime() > limitMs;
      if (item.late) item.logger.info({ etapa: this.name }, 'mensagem atrasada');
    }
    const time = (item: PipelineItem) => item.timestamp?.getTime() ?? Number.POSITIVE_INFINITY;
    return [...items].sort((a, b) => time(a) - time(b));
  }
}
