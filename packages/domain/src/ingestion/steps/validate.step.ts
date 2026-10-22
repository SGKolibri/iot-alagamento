import type { CanonicalMessage } from '../model';
import type { SchemaValidatorPort } from '../ports';
import { pending, refuse, type IngestionStep, type PipelineItem } from './step';

const STEP = 'validar';

export class ValidateStep implements IngestionStep {
  readonly name = STEP;
  constructor(private readonly validator: SchemaValidatorPort) {}

  async run(items: PipelineItem[]): Promise<PipelineItem[]> {
    for (const item of pending(items)) {
      const issues = this.validator.validateMessage(item.raw);
      if (issues.length > 0) {
        refuse(item, STEP, issues);
        continue;
      }
      const message = item.raw as CanonicalMessage;
      if (message.tipo === 'comando') {
        refuse(item, STEP, [
          {
            path: '/tipo',
            rule: 'sentido',
            message: 'comando vai da plataforma para o dispositivo e não entra pela ingestão',
          },
        ]);
        continue;
      }
      if (!item.device) {
        refuse(item, STEP, [
          { path: '/dispositivo', rule: 'cadastro', message: 'dispositivo não identificado' },
        ]);
        continue;
      }
      item.message = message;
      item.timestamp = new Date(message.timestamp);
    }
    return items;
  }
}
