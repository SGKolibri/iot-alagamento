import {
  executeActions,
  type ActionContext,
  type ActionDeps,
  type LoggerPort,
  type RuleDefinition,
} from '@iot/domain';

// Executa as ações de uma regra fora da avaliação: o consumidor não espera webhook nem MQTT.
// As ações saem depois do commit, no máximo uma vez (ADR-021).
export class ActionRunner {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly deps: ActionDeps,
    private readonly logger: LoggerPort,
  ) {}

  run(rule: RuleDefinition, context: ActionContext): void {
    if (!rule.actions.some((a) => a.type !== 'alarm')) return;
    const job = executeActions(rule.actions, context, this.deps)
      .then((results) => {
        for (const result of results.filter((r) => r.status === 'falhou')) {
          this.logger.warn(
            {
              regra: rule.id,
              dispositivo: context.device.id,
              acao: result.type,
              erro: result.error,
            },
            'ação da regra falhou',
          );
        }
      })
      .catch((error: unknown) =>
        this.logger.error({ regra: rule.id, erro: String(error) }, 'falha ao executar ações'),
      )
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  // No desligamento, espera as ações em curso.
  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
