import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import request from 'supertest';
import { percentile } from '../support/event-collector';
import { createTenant, startTestApp, type TestApp } from '../support/app';

// RNF-02: com 500 mensagens/s por MQTT durante 60 s, o alarme abre em até 3 s (p95) depois da
// publicação. Testcontainers; roda só com PERF_TEST=1 (pnpm test:perf).
const TENANT = 'carga-regras';
const DEVICES = 50;
const RATE = 500;
const SECONDS = 60;
const TICK_MS = 100;
// A cada 20 leituras de um dispositivo, uma cruza o limite (abre) e a seguinte volta (resolve).
const CROSS_EVERY = 20;

function report(label: string, data: unknown): void {
  process.stdout.write(`\n[desempenho] ${label}: ${JSON.stringify(data)}\n`);
}

describe('latência do motor de regras sob carga (RNF-02)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
    await createTenant(t.db, TENANT);
    const post = async (path: string, body: object) =>
      (
        await request(t.app.getHttpServer())
          .post(`/api/v1${path}`)
          .set('X-Tenant', TENANT)
          .send(body)
          .expect(201)
      ).body;
    const dominio = await post('/catalogo/dominios', { slug: 'carga', nome: 'Carga' });
    const perfil = await post('/perfis', {
      dominio_id: dominio.id,
      nome: 'nível',
      intervalo_esperado_s: 60,
      grandezas: [{ nome: 'nivel', unidade: 'cm' }],
    });
    const site = await post('/sites', { slug: 'laboratorio', nome: 'Laboratório' });
    for (let i = 0; i < DEVICES; i++) {
      await post('/dispositivos', {
        slug: `nivel-${String(i).padStart(3, '0')}`,
        perfil_id: perfil.id,
        site_id: site.id,
      });
    }
    await post('/regras', {
      nome: 'carga: nível acima do limite',
      escopo: 'central',
      ativa: true,
      condicao: { grandeza: 'nivel', operador: '>=', limite: 100 },
      acoes: [{ tipo: 'gerar_alarme', severidade: 'alta' }],
    });
  }, 300_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  it(`${RATE} msg/s por ${SECONDS} s: p95 da publicação à abertura do alarme até 3 s`, async () => {
    const client = await mqtt.connectAsync(
      `mqtt://${t.infra.env.MQTT_HOST}:${t.infra.env.MQTT_PORT}`,
      { username: t.infra.env.MQTT_INGEST_USERNAME, password: t.infra.env.MQTT_INGEST_PASSWORD },
    );
    // Horário da medição de cada leitura que cruza o limite -> instante da publicação.
    const crossings = new Map<string, number>();
    const perTick = (RATE * TICK_MS) / 1000;
    const ticks = (SECONDS * 1000) / TICK_MS;
    let sequence = 0;
    const started = Date.now();
    for (let tick = 0; tick < ticks; tick++) {
      const publishes: Promise<unknown>[] = [];
      for (let k = 0; k < perTick; k++) {
        const n = sequence++;
        const device = n % DEVICES;
        const reading = Math.floor(n / DEVICES);
        const crossing = reading % CROSS_EVERY === CROSS_EVERY - 1;
        const slug = `nivel-${String(device).padStart(3, '0')}`;
        const timestamp = new Date(started + n).toISOString();
        if (crossing) crossings.set(`${slug}|${timestamp}`, Date.now());
        publishes.push(
          client.publishAsync(
            `${TENANT}/laboratorio/carga/${slug}/telemetria`,
            JSON.stringify({
              versao: '1.0',
              id_mensagem: randomUUID(),
              dispositivo: slug,
              tipo: 'telemetria',
              timestamp,
              medidas: [{ grandeza: 'nivel', valor: crossing ? 150 : 50, unidade: 'cm' }],
            }),
            { qos: 1 },
          ),
        );
      }
      await Promise.all(publishes);
      const wait = started + (tick + 1) * TICK_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    const publishedIn = Date.now() - started;
    await client.endAsync();

    // Espera o motor alcançar a fila (até 60 s) e lê os alarmes abertos.
    const deadline = Date.now() + 60_000;
    let rows: { slug: string; occurred_at: Date; opened_at: Date }[] = [];
    while (Date.now() < deadline) {
      rows = (
        await t.db.query(
          `SELECT d.slug, a.occurred_at, a.opened_at FROM alarms a
             JOIN devices d ON d.id = a.device_id`,
        )
      ).rows;
      if (rows.length >= crossings.size) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const latencies = rows.map(
      (r) => r.opened_at.getTime() - crossings.get(`${r.slug}|${r.occurred_at.toISOString()}`)!,
    );
    const result = {
      mensagens: sequence,
      segundos_publicando: publishedIn / 1000,
      taxa_msg_s: Math.round(sequence / (publishedIn / 1000)),
      cruzamentos: crossings.size,
      alarmes: rows.length,
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      p99_ms: percentile(latencies, 99),
      max_ms: Math.max(...latencies),
    };
    report('motor de regras', result);

    expect(rows).toHaveLength(crossings.size);
    expect(latencies.every((l) => Number.isFinite(l))).toBe(true);
    expect(result.p95_ms).toBeLessThanOrEqual(3000);
  }, 300_000);
});
