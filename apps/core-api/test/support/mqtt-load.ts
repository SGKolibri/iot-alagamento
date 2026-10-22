import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import type pg from 'pg';

export interface LoadTarget {
  url: string;
  username: string;
  password: string;
  topic: string;
  device: string;
}

// Mensagens com horários únicos (a chave da hipertabela é dispositivo, grandeza e horário).
let clock = Date.UTC(2026, 0, 1);
function message(device: string, publisher: number, sequence: number) {
  clock += 1;
  return {
    versao: '1.0',
    id_mensagem: randomUUID(),
    dispositivo: device,
    tipo: 'telemetria',
    timestamp: new Date(clock).toISOString(),
    medidas: [{ grandeza: 'temperatura', valor: publisher * 100_000 + sequence, unidade: 'Cel' }],
  };
}

export interface BurstResult {
  confirmed: string[];
  // Instante (ms) em que o broker confirmou cada mensagem.
  confirmedAt: Map<string, number>;
  failed: number;
  elapsedMs: number;
}

// Publica `total` mensagens QoS 1 divididas entre `publishers` conexões. Cada publicador usa
// um contador sequencial; só entram em `confirmed` as mensagens com PUBACK do broker.
export async function publishBurst(
  target: LoadTarget,
  publishers: number,
  total: number,
  options: { ratePerSecond?: number; onProgress?: (sent: number) => void } = {},
): Promise<BurstResult> {
  const clients = await Promise.all(
    Array.from({ length: publishers }, () =>
      mqtt.connectAsync(target.url, {
        username: target.username,
        password: target.password,
        reconnectPeriod: 1000,
      }),
    ),
  );
  const confirmed: string[] = [];
  const confirmedAt = new Map<string, number>();
  let failed = 0;
  let sent = 0;
  const started = Date.now();
  const perPublisher = Math.ceil(total / publishers);
  await Promise.all(
    clients.map(async (client, publisher) => {
      for (
        let sequence = 0;
        sequence < perPublisher && publisher * perPublisher + sequence < total;
        sequence++
      ) {
        if (options.ratePerSecond) {
          // Ritmo constante: a mensagem n de todos os publicadores sai no instante n / taxa.
          const due = started + ((sent + 1) / options.ratePerSecond) * 1000;
          const wait = due - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
        const body = message(target.device, publisher, sequence);
        sent += 1;
        options.onProgress?.(sent);
        try {
          await client.publishAsync(target.topic, JSON.stringify(body), { qos: 1 });
          confirmed.push(body.id_mensagem);
          confirmedAt.set(body.id_mensagem, Date.now());
        } catch {
          failed += 1;
        }
      }
    }),
  );
  const elapsedMs = Date.now() - started;
  await Promise.all(clients.map((client) => client.endAsync()));
  return { confirmed, confirmedAt, failed, elapsedMs };
}

export interface Accounting {
  confirmed: number;
  stored: number;
  deadLetters: number;
  missing: number;
}

// Contabilidade do handoff: emitidas confirmadas = armazenadas + recusadas na DLQ (+ duplicadas,
// que não mudam o conjunto de ids distintos).
export async function account(db: pg.Pool, ids: string[]): Promise<Accounting> {
  const stored = new Set(
    (
      await db.query<{ id: string }>(
        'SELECT DISTINCT message_id::text AS id FROM measurements WHERE message_id = ANY($1::uuid[])',
        [ids],
      )
    ).rows.map((r) => r.id),
  );
  const dead = new Set(
    (
      await db.query<{ id: string }>(
        'SELECT DISTINCT message_id AS id FROM dead_letters WHERE message_id = ANY($1::text[])',
        [ids],
      )
    ).rows.map((r) => r.id),
  );
  const missing = ids.filter((id) => !stored.has(id) && !dead.has(id)).length;
  return { confirmed: ids.length, stored: stored.size, deadLetters: dead.size, missing };
}

// Espera a drenagem: termina quando nada falta ou quando a contagem para de mudar por `idleMs`.
export async function drain(
  db: pg.Pool,
  ids: string[],
  timeoutMs: number,
  idleMs = 5000,
): Promise<Accounting> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let lastChange = Date.now();
  for (;;) {
    const result = await account(db, ids);
    if (result.missing === 0) return result;
    if (result.missing !== last) {
      last = result.missing;
      lastChange = Date.now();
    }
    if (Date.now() > deadline || Date.now() - lastChange > idleMs) return result;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Contadores $SYS do Mosquitto (atualizados a cada sys_interval, 10 s por padrão).
export async function brokerCounters(target: LoadTarget, topics: string[], waitMs = 12_000) {
  const client = await mqtt.connectAsync(target.url, {
    username: target.username,
    password: target.password,
  });
  const values: Record<string, string> = {};
  client.on('message', (topic, payload) => {
    values[topic] = payload.toString();
  });
  await client.subscribeAsync(topics);
  await new Promise((r) => setTimeout(r, waitMs));
  await client.endAsync();
  return values;
}
