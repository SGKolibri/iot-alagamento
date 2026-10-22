import type { Action, Condition, Duration, Operator, RuleDefinition } from '@iot/domain';
import type { StoredRule } from './rules.repository';

// Conversão do contrato rule.v1 (campos em português) para o modelo do domínio.
interface ContractDuration {
  leituras?: number;
  segundos?: number;
}

const duration = (d: ContractDuration | undefined): Duration | undefined =>
  d === undefined
    ? undefined
    : {
        ...(d.leituras !== undefined ? { readings: d.leituras } : {}),
        ...(d.segundos !== undefined ? { seconds: d.segundos } : {}),
      };

interface ContractCondition {
  grandeza?: string;
  operador?: Operator;
  limite?: number;
  duracao?: ContractDuration;
  taxa?: { operador: Operator; limite: number; janela_s: number; minimo_pontos: number };
  saida?: { operador: Operator; limite: number; duracao?: ContractDuration };
  area_id?: string | null;
  ausencia?: { intervalos: number };
}

export function toCondition(c: ContractCondition): Condition {
  return {
    ...(c.grandeza !== undefined ? { quantity: c.grandeza } : {}),
    ...(c.operador !== undefined ? { operator: c.operador, threshold: c.limite! } : {}),
    ...(c.duracao ? { duration: duration(c.duracao) } : {}),
    ...(c.taxa
      ? {
          rate: {
            operator: c.taxa.operador,
            threshold: c.taxa.limite,
            windowS: c.taxa.janela_s,
            minPoints: c.taxa.minimo_pontos,
          },
        }
      : {}),
    ...(c.saida
      ? {
          exit: {
            operator: c.saida.operador,
            threshold: c.saida.limite,
            ...(c.saida.duracao ? { duration: duration(c.saida.duracao) } : {}),
          },
        }
      : {}),
    ...(c.area_id ? { areaId: c.area_id } : {}),
    ...(c.ausencia ? { absence: { intervals: c.ausencia.intervalos } } : {}),
  };
}

type ContractAction =
  | { tipo: 'gerar_alarme'; severidade: 'baixa' | 'media' | 'alta' | 'critica' }
  | { tipo: 'notificar'; canais: string[]; supressao_s?: number }
  | { tipo: 'webhook'; url: string; tempo_limite_ms?: number }
  | { tipo: 'publicar_topico'; topico: string }
  | { tipo: 'enviar_comando'; comando: { nome: string; parametros?: Record<string, unknown> } };

export function toAction(a: ContractAction): Action {
  switch (a.tipo) {
    case 'gerar_alarme':
      return { type: 'alarm', severity: a.severidade };
    case 'notificar':
      return {
        type: 'notify',
        channels: a.canais,
        ...(a.supressao_s !== undefined ? { suppressionS: a.supressao_s } : {}),
      };
    case 'webhook':
      return {
        type: 'webhook',
        url: a.url,
        ...(a.tempo_limite_ms !== undefined ? { timeoutMs: a.tempo_limite_ms } : {}),
      };
    case 'publicar_topico':
      return { type: 'topic', topic: a.topico };
    case 'enviar_comando':
      return {
        type: 'command',
        name: a.comando.nome,
        ...(a.comando.parametros ? { parameters: a.comando.parametros } : {}),
      };
  }
}

export function toRuleDefinition(rule: StoredRule): RuleDefinition {
  return {
    id: rule.id,
    tenantId: rule.tenantId,
    name: rule.nome,
    scope: rule.escopo,
    active: rule.ativa,
    version: rule.versao,
    condition: toCondition(rule.condicao as ContractCondition),
    actions: (rule.acoes as unknown as ContractAction[]).map(toAction),
  };
}
