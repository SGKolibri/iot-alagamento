import { compileExpression, ExpressionError, type CompiledExpression } from '../expression';
import type { Issue, Measurement, QuantitySpec } from '../model';
import { convertUnit } from '../units';
import {
  pending,
  refuse,
  type IngestionStep,
  type PipelineContext,
  type PipelineItem,
} from './step';

const STEP = 'enriquecer';

function outOfRange(value: number, spec: QuantitySpec): boolean {
  const { min, max } = spec.range ?? {};
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

// RF-PRO-01: normaliza unidades, marca valores fora da faixa como suspeitos, calcula grandezas
// derivadas e completa o local com o cadastro do dispositivo.
export class EnrichStep implements IngestionStep {
  readonly name = STEP;
  private readonly expressions = new Map<string, CompiledExpression | null>();

  async run(items: PipelineItem[], context: PipelineContext): Promise<PipelineItem[]> {
    for (const item of pending(items)) {
      const device = item.device!;
      const message = item.message!;
      const base = {
        tenantId: device.tenantId,
        deviceId: device.id,
        timestamp: item.timestamp!,
        late: item.late,
        messageId: message.id_mensagem,
        receivedAt: context.receivedAt,
      };

      const issues: Issue[] = [];
      const measurements: Measurement[] = [];
      for (const [position, measure] of (message.medidas ?? []).entries()) {
        const spec = device.profile.quantities.find((q) => q.name === measure.grandeza);
        if (!spec || spec.expression) {
          issues.push({
            path: `/medidas/${position}/grandeza`,
            rule: 'perfil',
            message: `a grandeza ${measure.grandeza} não existe no perfil do dispositivo`,
          });
          continue;
        }
        const value = convertUnit(measure.valor, measure.unidade, spec.unit);
        if (value === null) {
          issues.push({
            path: `/medidas/${position}/unidade`,
            rule: 'unidade',
            message: `a unidade ${measure.unidade} não converte para ${spec.unit} (grandeza ${spec.name})`,
          });
          continue;
        }
        measurements.push({
          ...base,
          quantity: spec.name,
          value,
          unit: spec.unit,
          suspect: outOfRange(value, spec),
          derived: false,
        });
      }
      if (issues.length > 0) {
        refuse(item, STEP, issues);
        continue;
      }

      const variables = new Map<string, number>();
      for (const [name, value] of Object.entries(device.attributes)) {
        variables.set(`atributos.${name}`, value);
      }
      for (const m of measurements) variables.set(m.quantity, m.value);

      // Grandezas derivadas só quando a mensagem traz medidas (telemetria ou evento com medidas).
      if (measurements.length > 0) {
        for (const spec of device.profile.quantities.filter((q) => q.expression)) {
          const value = this.compile(spec, item)?.evaluate(variables) ?? null;
          if (value === null) continue;
          variables.set(spec.name, value);
          measurements.push({
            ...base,
            quantity: spec.name,
            value,
            unit: spec.unit,
            suspect: outOfRange(value, spec),
            derived: true,
          });
        }
      }

      item.measurements = measurements;
      item.location = { ...device.location, ...message.local };
    }
    return items;
  }

  // Expressão inválida no perfil não derruba a mensagem: a grandeza derivada fica de fora
  // e o erro vai para o log. A validação na criação do perfil chega na T1b.
  private compile(spec: QuantitySpec, item: PipelineItem): CompiledExpression | null {
    const source = spec.expression!;
    if (!this.expressions.has(source)) {
      try {
        this.expressions.set(source, compileExpression(source));
      } catch (error) {
        if (!(error instanceof ExpressionError)) throw error;
        this.expressions.set(source, null);
        item.logger.error(
          { etapa: STEP, grandeza: spec.name, erro: error.message },
          'expressão de grandeza derivada inválida no perfil',
        );
      }
    }
    return this.expressions.get(source)!;
  }
}
