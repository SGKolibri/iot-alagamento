// pnpm bench:ingestion: linha de base de desempenho da ingestão, sem otimização (T1a-ajustes).
// Requer a infraestrutura local de pé (docker compose up -d) e o .env da raiz.
//
// Mede, para MQTT (QoS 1, publicadores em paralelo) e para lotes HTTP de 500 mensagens:
// - vazão: mensagens gravadas por segundo, do primeiro envio ao último evento observado;
// - latência por mensagem: do recebimento no core-api (receivedAt, gravado pelo pipeline) até
//   o evento measurement.ingested no Redis, que só sai depois da gravação na hipertabela.
//
// Cenários de MQTT:
// - sem controle de vazão: publica tudo de uma vez e conta quantas mensagens foram gravadas;
// - com janela: no máximo --janela mensagens publicadas e ainda não gravadas, o que mede a vazão
//   sustentável sem estourar a fila do broker para o assinante.
//
// Opções: --mqtt-n 5000 --rajada-n 3000 --janela 500 --publicadores 8 --lotes 20
//         --tamanho-lote 500 --concorrencia 4 (log em BENCH_LOG_LEVEL, padrão warn)
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cpus, totalmem, release, type } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { buildBatch, buildMessages, topicFor, type PublisherOptions } from '@iot/simulators';
import Redis from 'ioredis';
import mqtt from 'mqtt';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { findRepoRoot, loadIngestionConfig } from '../src/ingestion/infra/config';
import { applyMigrations } from '../src/ingestion/infra/sql-migrations';

const { values } = parseArgs({
  options: {
    'mqtt-n': { type: 'string', default: '5000' },
    'rajada-n': { type: 'string', default: '3000' },
    janela: { type: 'string', default: '500' },
    publicadores: { type: 'string', default: '8' },
    lotes: { type: 'string', default: '20' },
    'tamanho-lote': { type: 'string', default: '500' },
    concorrencia: { type: 'string', default: '4' },
  },
});

const STREAM = 'measurement.ingested';
const DEVICE: Omit<PublisherOptions, 'count' | 'start'> = {
  tenant: 'defesa-civil',
  site: 'bairro-centro',
  domain: 'alagamento',
  device: 'nivel-corrego-01',
  quantity: 'distancia_agua',
  unit: 'cm',
  initialValue: 150,
  step: 0,
  intervalMs: 1,
};

interface Observation {
  receivedAt: number;
  observedAt: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

// Lê o stream do barramento e guarda o instante em que cada mensagem esperada aparece.
class EventCollector {
  private readonly seen = new Map<string, Observation>();
  private running = true;
  private lastId = '$';
  private loop?: Promise<void>;

  constructor(private readonly redis: Redis) {}

  async start(): Promise<void> {
    const [last] = await this.redis.xrevrange(STREAM, '+', '-', 'COUNT', 1);
    this.lastId = last?.[0] ?? '0-0';
    this.loop = this.poll();
  }

  private async poll(): Promise<void> {
    while (this.running) {
      const result = await this.redis.xread(
        'COUNT',
        5000,
        'BLOCK',
        500,
        'STREAMS',
        STREAM,
        this.lastId,
      );
      const observedAt = Date.now();
      for (const [, entries] of result ?? []) {
        for (const [id, fields] of entries) {
          this.lastId = id;
          const event = JSON.parse(fields[1]!) as { messageId: string; receivedAt: string };
          this.seen.set(event.messageId, {
            receivedAt: Date.parse(event.receivedAt),
            observedAt,
          });
        }
      }
    }
  }

  count(ids: string[]): number {
    return ids.filter((id) => this.seen.has(id)).length;
  }

  // Espera até nenhum evento novo chegar por idleMs; devolve quantas mensagens apareceram.
  async waitIdle(ids: string[], idleMs: number): Promise<number> {
    let last = -1;
    for (;;) {
      const now = this.count(ids);
      if (now === last || now === ids.length) return now;
      last = now;
      await new Promise((r) => setTimeout(r, idleMs));
    }
  }

  async waitFor(ids: string[], timeoutMs: number): Promise<Observation[]> {
    const deadline = Date.now() + timeoutMs;
    while (ids.some((id) => !this.seen.has(id))) {
      if (Date.now() > deadline) {
        const missing = ids.filter((id) => !this.seen.has(id)).length;
        throw new Error(`${missing} de ${ids.length} mensagens não chegaram em ${timeoutMs} ms`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return ids.map((id) => this.seen.get(id)!);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }
}

function summarize(label: string, startedAt: number, observations: Observation[]) {
  const latencies = observations.map((o) => o.observedAt - o.receivedAt).sort((a, b) => a - b);
  const finishedAt = Math.max(...observations.map((o) => o.observedAt));
  const seconds = (finishedAt - startedAt) / 1000;
  return {
    cenario: label,
    mensagens: observations.length,
    duracao_s: Number(seconds.toFixed(2)),
    msg_por_s: Math.round(observations.length / seconds),
    latencia_p50_ms: percentile(latencies, 50),
    latencia_p95_ms: percentile(latencies, 95),
    latencia_max_ms: latencies.at(-1),
  };
}

// Horários únicos por execução: a chave da hipertabela é (dispositivo, grandeza, horário).
function uniqueStart(): Date {
  return new Date(Date.UTC(2025, 0, 1) + Math.floor(Math.random() * 300 * 86_400_000));
}

async function connectPublishers(count: number) {
  const env = process.env;
  return Promise.all(
    Array.from({ length: count }, () =>
      mqtt.connectAsync(`mqtt://${env.MQTT_HOST ?? 'localhost'}:${env.MQTT_PORT ?? 1883}`, {
        username: env.MQTT_DEV_USERNAME,
        password: env.MQTT_DEV_PASSWORD,
      }),
    ),
  );
}

// Publica tudo o mais rápido possível e conta quantas mensagens chegaram a ser gravadas.
async function benchMqttBurst(collector: EventCollector, count: number, publishers: number) {
  const messages = buildMessages({ ...DEVICE, count, start: uniqueStart() });
  const clients = await connectPublishers(publishers);
  const topic = topicFor(DEVICE);
  await Promise.all(
    clients.map(async (client, index) => {
      for (let i = index; i < messages.length; i += publishers) {
        await client.publishAsync(topic, JSON.stringify(messages[i]), { qos: 1 });
      }
    }),
  );
  const stored = await collector.waitIdle(
    messages.map((m) => m.id_mensagem),
    5_000,
  );
  await Promise.all(clients.map((client) => client.endAsync()));
  return {
    cenario: `MQTT QoS 1 sem controle de vazão, ${publishers} publicadores`,
    publicadas: count,
    gravadas: stored,
    perdidas: count - stored,
  };
}

// Vazão sustentável: os publicadores esperam enquanto houver mais de `window` mensagens
// publicadas e ainda não gravadas.
async function benchMqttWindow(
  collector: EventCollector,
  count: number,
  publishers: number,
  window: number,
) {
  const messages = buildMessages({ ...DEVICE, count, start: uniqueStart() });
  const ids = messages.map((m) => m.id_mensagem);
  const clients = await connectPublishers(publishers);
  const topic = topicFor(DEVICE);
  let published = 0;
  let next = 0;
  const startedAt = Date.now();
  await Promise.all(
    clients.map(async (client) => {
      while (next < messages.length) {
        while (published - collector.count(ids.slice(0, published)) >= window) {
          await new Promise((r) => setTimeout(r, 5));
        }
        // Outro publicador pode ter pegado a última mensagem durante a espera.
        const index = next++;
        if (index >= messages.length) break;
        published += 1;
        await client.publishAsync(topic, JSON.stringify(messages[index]), { qos: 1 });
      }
    }),
  );
  const observations = await collector.waitFor(ids, 180_000);
  await Promise.all(clients.map((client) => client.endAsync()));
  return summarize(
    `MQTT QoS 1 com janela de ${window}, ${publishers} publicadores`,
    startedAt,
    observations,
  );
}

async function benchHttp(
  collector: EventCollector,
  baseUrl: string,
  batches: number,
  batchSize: number,
  concurrency: number,
) {
  const token = process.env.SIM_DEVICE_TOKEN ?? '';
  const start = uniqueStart();
  const all = buildMessages({ ...DEVICE, count: batches * batchSize, start });
  const bodies = Array.from({ length: batches }, (_, b) =>
    buildBatch(all.slice(b * batchSize, (b + 1) * batchSize), DEVICE.device),
  );
  const startedAt = Date.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < bodies.length) {
        const body = bodies[next++]!;
        const response = await fetch(`${baseUrl}/api/v1/ingestao/lote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (response.status !== 200) throw new Error(`lote respondeu ${response.status}`);
      }
    }),
  );
  const observations = await collector.waitFor(
    all.map((m) => m.id_mensagem),
    180_000,
  );
  return summarize(
    `HTTP, lotes de ${batchSize}, ${concurrency} em paralelo`,
    startedAt,
    observations,
  );
}

// Sessão persistente esquecida num grupo compartilhado continua recebendo a sua parte das
// mensagens (ADR-017); conectar com clean: true apaga a sessão no broker.
async function cleanSessions(base: string, connections: number): Promise<void> {
  const env = process.env;
  for (let index = 0; index < connections; index++) {
    const client = await mqtt.connectAsync(
      `mqtt://${env.MQTT_HOST ?? 'localhost'}:${env.MQTT_PORT ?? 1883}`,
      {
        username: env.MQTT_DEV_USERNAME,
        password: env.MQTT_DEV_PASSWORD,
        clientId: `${base}-${index}`,
        clean: true,
      },
    );
    await client.endAsync();
  }
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  // Identificadores e grupo de assinatura próprios, para não disputar as sessões de um core-api
  // já rodando. As sessões persistentes do benchmark são apagadas no fim (cleanSessions).
  const benchId = `bench-${randomUUID()}`;
  process.env.MQTT_INGEST_CLIENT_ID = benchId;
  process.env.MQTT_INGEST_SHARE_GROUP = benchId;
  process.env.LOG_LEVEL = process.env.BENCH_LOG_LEVEL ?? 'warn';

  const config = loadIngestionConfig();
  const pool = new Pool(config.postgres);
  await applyMigrations(pool, join(root, 'migrations/sql'));
  await pool.end();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  const redis = new Redis({ ...config.redis });
  const collector = new EventCollector(redis);
  await collector.start();

  try {
    const results = [
      await benchMqttBurst(collector, Number(values['rajada-n']), Number(values.publicadores)),
      await benchMqttWindow(
        collector,
        Number(values['mqtt-n']),
        Number(values.publicadores),
        Number(values.janela),
      ),
      await benchHttp(
        collector,
        `http://127.0.0.1:${address.port}`,
        Number(values.lotes),
        Number(values['tamanho-lote']),
        Number(values.concorrencia),
      ),
    ];
    const cpu = cpus()[0]?.model ?? 'desconhecida';
    console.log(
      JSON.stringify(
        {
          maquina: {
            cpu,
            nucleos: cpus().length,
            memoria_gb: Math.round(totalmem() / 1024 ** 3),
            so: `${type()} ${release()}`,
            node: process.version,
            log: process.env.LOG_LEVEL,
          },
          resultados: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await collector.stop();
    redis.disconnect();
    await app.close();
    await cleanSessions(benchId, config.mqtt?.connections ?? 0);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
