import type { TopicAddress } from '@iot/domain';

export const INGESTION_KINDS = ['telemetria', 'evento', 'estado'] as const;
export const INGESTION_TOPICS = INGESTION_KINDS.map((kind) => `+/+/+/+/${kind}`);

// {inquilino}/{site}/{dominio}/{dispositivo}/{tipo}
export function parseTopic(topic: string): TopicAddress | null {
  const parts = topic.split('/');
  if (parts.length !== 5 || parts.some((part) => part.length === 0)) return null;
  const [tenant, site, domain, device, kind] = parts as [string, string, string, string, string];
  if (!(INGESTION_KINDS as readonly string[]).includes(kind)) return null;
  return { tenant, site, domain, device, kind };
}

// Assinatura compartilhada: o broker reparte as mensagens entre as conexões do grupo.
export function sharedSubscriptions(group: string): string[] {
  return INGESTION_TOPICS.map((topic) => `$share/${group}/${topic}`);
}
