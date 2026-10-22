import { Injectable } from '@nestjs/common';
import type { MessageOutcome } from '@iot/domain';
import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

export type Origin = 'mqtt' | 'http' | 'batch';
export type Outcome = 'aceita' | 'duplicada' | 'recusada' | 'nao_autenticada' | 'pendente';

const BY_STATUS: Record<MessageOutcome['status'], Outcome> = {
  accepted: 'aceita',
  duplicate: 'duplicada',
  refused: 'recusada',
  unauthorized: 'nao_autenticada',
};

// RF-OBS-01 e T1-vazão: toda mensagem termina num desfecho contado. "pendente" é a falha
// transitória que fica sem confirmação para reentrega.
@Injectable()
export class IngestionMetrics {
  readonly registry = new Registry();
  private readonly messages = new Counter({
    name: 'ingestao_mensagens_total',
    help: 'Mensagens recebidas pela ingestão, por origem e desfecho',
    labelNames: ['origem', 'desfecho'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  count(origin: Origin, outcome: Outcome, amount = 1): void {
    this.messages.inc({ origem: origin, desfecho: outcome }, amount);
  }

  countOutcome(origin: Origin, outcome: MessageOutcome): void {
    this.count(origin, BY_STATUS[outcome.status]);
  }
}
