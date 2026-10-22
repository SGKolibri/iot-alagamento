import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

// RF-DAD-01, desempenho: roda contra o compose depois de pnpm seed:load-series (pnpm test:perf).
const TENANT = 'carga-series';
const HOUR = 3_600_000;
const root = resolve(__dirname, '../../../..');

function report(label: string, data: unknown): void {
  process.stdout.write(`\n[desempenho] ${label}: ${JSON.stringify(data)}\n`);
}

describe('desempenho da série sobre 8,6 milhões de medições', () => {
  let app: NestExpressApplication;
  let db: pg.Pool;
  let deviceId: string;
  let areaId: string;
  let end: Date;

  beforeAll(async () => {
    // process.loadEnvFile grava no process.env real, fora do sandbox do Jest.
    if (existsSync(join(root, '.env')))
      Object.assign(process.env, parseEnv(readFileSync(join(root, '.env'), 'utf8')));
    // Sem MQTT e sem tarefas de fundo: só a API e o banco do compose.
    delete process.env.MQTT_HOST;
    delete process.env.REDIS_HOST;
    process.env.LOG_LEVEL = 'silent';
    db = new pg.Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    const device = await db.query<{ id: string; end: Date }>(
      `SELECT d.id, (SELECT max(ts) FROM measurements m WHERE m.device_id = d.id) AS end
         FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = $1 AND d.slug = 'carga-000'`,
      [TENANT],
    );
    if (!device.rows[0]) throw new Error('Rode pnpm seed:load-series antes de pnpm test:perf');
    deviceId = device.rows[0].id;
    end = new Date(device.rows[0].end.getTime() + 60_000);
    areaId = (
      await db.query<{ id: string }>(
        "SELECT a.id FROM areas a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = $1 AND a.slug = 'area-carga'",
        [TENANT],
      )
    ).rows[0]!.id;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  async function measure(path: string, expectedPoints: (body: Record<string, unknown>) => number) {
    const call = () =>
      request(app.getHttpServer()).get(`/api/v1${path}`).set('X-Tenant', TENANT).expect(200);
    await call();
    const times: number[] = [];
    let points = 0;
    for (let i = 0; i < 5; i++) {
      const started = process.hrtime.bigint();
      const response = await call();
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      points = expectedPoints(response.body as Record<string, unknown>);
    }
    times.sort((a, b) => a - b);
    return { pontos: points, mediana_ms: Math.round(times[2]!), pior_ms: Math.round(times[4]!) };
  }

  async function explain(sql: string, params: unknown[]): Promise<void> {
    const { rows } = await db.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    process.stdout.write(`${rows.map((r) => `    ${r['QUERY PLAN']}`).join('\n')}\n`);
  }

  const range = (hours: number) =>
    `de=${new Date(end.getTime() - hours * HOUR).toISOString()}&ate=${end.toISOString()}`;
  const pointsOf = (body: Record<string, unknown>) => (body.pontos as unknown[]).length;

  it('24 h de um dispositivo, pontos brutos, em até 1 s', async () => {
    const result = await measure(
      `/dispositivos/${deviceId}/telemetria?grandeza=temperatura&${range(24)}`,
      pointsOf,
    );
    report('24 h de um dispositivo', result);
    await explain(
      `SELECT device_id, quantity, ts, value FROM measurements
        WHERE tenant_id = (SELECT tenant_id FROM devices WHERE id = $1) AND device_id = ANY(ARRAY[$1]::uuid[])
          AND quantity = 'temperatura' AND ts >= $2 AND ts <= $3 ORDER BY device_id, ts, quantity LIMIT 50001`,
      [deviceId, new Date(end.getTime() - 24 * HOUR), end],
    );
    expect(result.pontos).toBeGreaterThanOrEqual(1439);
    expect(result.pior_ms).toBeLessThanOrEqual(1000);
  });

  it('7 d com bucket de 15 min em até 1 s', async () => {
    const result = await measure(
      `/dispositivos/${deviceId}/telemetria?grandeza=temperatura&${range(168)}&bucket=15m`,
      pointsOf,
    );
    report('7 d, bucket de 15 min', result);
    await explain(
      `SELECT device_id, quantity, time_bucket('15 minutes', ts) AS inicio, avg(value), min(value), max(value), count(*)
         FROM measurements WHERE tenant_id = (SELECT tenant_id FROM devices WHERE id = $1)
          AND device_id = ANY(ARRAY[$1]::uuid[]) AND quantity = 'temperatura' AND ts >= $2 AND ts <= $3
        GROUP BY device_id, quantity, inicio ORDER BY device_id, inicio, quantity LIMIT 50001`,
      [deviceId, new Date(end.getTime() - 168 * HOUR), end],
    );
    expect(result.pontos).toBeGreaterThanOrEqual(672);
    expect(result.pior_ms).toBeLessThanOrEqual(1000);
  });

  it('30 d com bucket de 1 h em até 1 s', async () => {
    const result = await measure(
      `/dispositivos/${deviceId}/telemetria?grandeza=temperatura&${range(720)}&bucket=1h`,
      pointsOf,
    );
    report('30 d, bucket de 1 h', result);
    await explain(
      `SELECT device_id, quantity, time_bucket('1 hour', ts) AS inicio, avg(value), min(value), max(value), count(*)
         FROM measurements WHERE tenant_id = (SELECT tenant_id FROM devices WHERE id = $1)
          AND device_id = ANY(ARRAY[$1]::uuid[]) AND quantity = 'temperatura' AND ts >= $2 AND ts <= $3
        GROUP BY device_id, quantity, inicio ORDER BY device_id, inicio, quantity LIMIT 50001`,
      [deviceId, new Date(end.getTime() - 720 * HOUR), end],
    );
    expect(result.pontos).toBeGreaterThanOrEqual(719);
    expect(result.pior_ms).toBeLessThanOrEqual(1000);
  });

  it('24 h de uma área com 10 dispositivos em até 2 s', async () => {
    const result = await measure(
      `/telemetria?area=${areaId}&grandeza=temperatura&${range(24)}`,
      (body) =>
        (body.series as { pontos: unknown[] }[]).reduce((sum, s) => sum + s.pontos.length, 0),
    );
    report('24 h da área (10 dispositivos)', result);
    expect(result.pontos).toBeGreaterThanOrEqual(14_390);
    expect(result.pior_ms).toBeLessThanOrEqual(2000);
  });
});
