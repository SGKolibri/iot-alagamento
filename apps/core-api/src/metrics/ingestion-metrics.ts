import { Injectable } from '@nestjs/common';
import type { MessageOutcome } from '@iot/domain';
import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';

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

  // Espelho do contador $SYS/broker/publish/messages/dropped do Mosquitto (ADR-017).
  readonly brokerDropped = new Counter({
    name: 'mqtt_broker_dropped_messages_total',
    help: 'Mensagens descartadas pelo broker MQTT (fila de sessão cheia)',
    registers: [this.registry],
  });

  // Mensagens guardadas no broker ($SYS/broker/store/messages/count): a fila ainda não drenada.
  readonly brokerPending = new Gauge({
    name: 'mqtt_ingest_pending_messages',
    help: 'Mensagens guardadas no broker MQTT, ainda não entregues ou não confirmadas',
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
