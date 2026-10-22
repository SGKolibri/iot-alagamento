import { randomUUID } from 'node:crypto';
import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';

const TENANT = 'inquilino-serie';
const square = (x: number, y: number, size: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});
const BUCKET_MS = { '1m': 60_000, '15m': 900_000, '1h': 3_600_000 } as const;

interface Point {
  ts: number;
  value: number;
}

// Cálculo independente, em memória, da média, do mínimo e do máximo por bucket.
function aggregate(points: Point[], bucketMs: number) {
  const groups = new Map<number, number[]>();
  for (const p of points) {
    const start = Math.floor(p.ts / bucketMs) * bucketMs;
    groups.set(start, [...(groups.get(start) ?? []), p.value]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, values]) => ({
      inicio: new Date(start).toISOString(),
      media: values.reduce((sum, v) => sum + v, 0) / values.length,
      minimo: Math.min(...values),
      maximo: Math.max(...values),
      quantidade: values.length,
    }));
}

describe('série com buckets (RF-DAD-01)', () => {
  let t: TestApp;
  let contract: ResponseValidator;
  let perfilId: string;
  let siteId: string;
  let areaId: string;
  const devices: Record<string, { id: string; slug: string; credencial: string }> = {};
  const points: Point[] = [];
  const base = Date.UTC(2026, 9, 20, 0, 0, 0);

  const get = (path: string) =>
    request(t.app.getHttpServer()).get(`/api/v1${path}`).set('X-Tenant', TENANT);
  const sendBatch = async (device: { slug: string; credencial: string }, batch: Point[]) =>
    request(t.app.getHttpServer())
      .post('/api/v1/ingestao/lote')
      .set('Authorization', `Bearer ${device.credencial}`)
      .send({
        versao: '1.0',
        id_lote: randomUUID(),
        origem: device.slug,
        mensagens: batch.map((p) => ({
          versao: '1.0',
          id_mensagem: randomUUID(),
          dispositivo: device.slug,
          tipo: 'telemetria',
          timestamp: new Date(p.ts).toISOString(),
          medidas: [{ grandeza: 'temperatura', valor: p.value, unidade: 'Cel' }],
        })),
      })
      .expect(200);

  beforeAll(async () => {
    contract = await createResponseValidator();
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
    const dominio = await post('/catalogo/dominios', { slug: 'clima', nome: 'Clima' });
    perfilId = (
      await post('/perfis', {
        dominio_id: dominio.id,
        nome: 'termômetro',
        intervalo_esperado_s: 60,
        grandezas: [{ nome: 'temperatura', unidade: 'Cel' }],
      })
    ).id;
    siteId = (await post('/sites', { slug: 'campo', nome: 'Campo' })).id;
    areaId = (
      await post('/areas', {
        site_id: siteId,
        slug: 'quadra',
        nome: 'Quadra',
        geometria: square(-48, -16, 1),
      })
    ).id;
    for (const [slug, coordinates] of [
      ['termo-a', [-47.5, -15.5]],
      ['termo-b', [-47.4, -15.4]],
      ['termo-fora', [-46, -15]],
      ['termo-cheio', [-46.5, -15]],
    ] as const) {
      devices[slug] = await post('/dispositivos', {
        slug,
        perfil_id: perfilId,
        site_id: siteId,
        localizacao: { type: 'Point', coordinates },
      });
    }
    // 2 h de pontos a cada 20 s, com valores irregulares, enviados fora de ordem.
    for (let i = 0; i < 360; i++)
      points.push({ ts: base + i * 20_000, value: Math.round(Math.sin(i) * 1000) / 10 + (i % 7) });
    const shuffled = [...points].sort(
      (a, b) => ((a.value * 31 + a.ts) % 97) - ((b.value * 31 + b.ts) % 97),
    );
    await sendBatch(devices['termo-a']!, shuffled);
    await sendBatch(devices['termo-b']!, points.slice(0, 30));
    await sendBatch(devices['termo-fora']!, points.slice(0, 30));
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  const range = `de=${new Date(base).toISOString()}&ate=${new Date(base + 2 * 3_600_000).toISOString()}`;

  it('sem bucket devolve os pontos brutos pela ordem do horário da medição', async () => {
    const body = (
      await get(
        `/dispositivos/${devices['termo-a']!.id}/telemetria?grandeza=temperatura&${range}`,
      ).expect(200)
    ).body;
    expect(contract.validate('SerieDispositivo', body).errors).toEqual([]);
    expect(body.bucket).toBeNull();
    expect(body.pontos).toHaveLength(360);
    expect(body.pontos.map((p: { timestamp: string }) => p.timestamp)).toEqual(
      points.map((p) => new Date(p.ts).toISOString()),
    );
  });

  it.each(['1m', '15m', '1h'] as const)(
    '4. com bucket %s, média, mínimo e máximo batem com o cálculo em memória',
    async (bucket) => {
      const body = (
        await get(
          `/dispositivos/${devices['termo-a']!.id}/telemetria?grandeza=temperatura&${range}&bucket=${bucket}`,
        ).expect(200)
      ).body;
      expect(contract.validate('SerieDispositivo', body).errors).toEqual([]);
      expect(body.bucket).toBe(bucket);
      const expected = aggregate(points, BUCKET_MS[bucket]);
      expect(body.pontos).toHaveLength(expected.length);
      body.pontos.forEach((p: Record<string, number | string>, i: number) => {
        const e = expected[i]!;
        expect(p).toMatchObject({
          grandeza: 'temperatura',
          inicio: e.inicio,
          minimo: e.minimo,
          maximo: e.maximo,
          quantidade: e.quantidade,
        });
        expect(p.media as number).toBeCloseTo(e.media, 9);
      });
    },
  );

  it('5. resposta acima do limite de pontos devolve erro claro no esquema Erro', async () => {
    const device = devices['termo-cheio']!;
    const { rows } = await t.db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM devices WHERE id = $1',
      [device.id],
    );
    await t.db.query(
      `INSERT INTO measurements (tenant_id, device_id, quantity, ts, value, unit, message_id)
       SELECT $1, $2, 'temperatura', $3::timestamptz + n * interval '1 second', n, 'Cel', gen_random_uuid()
         FROM generate_series(0, 50000) AS n`,
      [rows[0]!.tenant_id, device.id, new Date(base).toISOString()],
    );
    const tooMany = await get(`/dispositivos/${device.id}/telemetria?${range}`).expect(400);
    expect(contract.validate('Erro', tooMany.body).errors).toEqual([]);
    expect(tooMany.body).toMatchObject({ codigo: 'pontos_demais' });
    expect(tooMany.body.mensagem).toContain('50000 pontos');
    const bucketed = await get(`/dispositivos/${device.id}/telemetria?${range}&bucket=1m`).expect(
      200,
    );
    expect(bucketed.body.pontos.length).toBeLessThanOrEqual(120);
  });

  it('6. medição atrasada aparece no bucket correto', async () => {
    const device = devices['termo-b']!;
    // Chega muito depois (atrasada) e cai no primeiro bucket de 15 m, entre os pontos já gravados.
    const late = { ts: base + 7 * 60_000 + 5_000, value: 999 };
    await sendBatch(device, [late]);
    const { rows } = await t.db.query(
      'SELECT late FROM measurements WHERE device_id = $1 AND ts = $2',
      [device.id, new Date(late.ts)],
    );
    expect(rows).toEqual([{ late: true }]);
    const body = (
      await get(`/dispositivos/${device.id}/telemetria?${range}&bucket=15m`).expect(200)
    ).body;
    const expected = aggregate([...points.slice(0, 30), late], BUCKET_MS['15m']);
    expect(body.pontos[0]).toMatchObject({
      inicio: expected[0]!.inicio,
      maximo: 999,
      quantidade: expected[0]!.quantidade,
    });
    const raw = (await get(`/dispositivos/${device.id}/telemetria?${range}`).expect(200)).body;
    const index = raw.pontos.findIndex((p: { valor: number }) => p.valor === 999);
    expect(raw.pontos[index]).toMatchObject({ atrasada: true });
    expect(raw.pontos[index - 1].timestamp < raw.pontos[index].timestamp).toBe(true);
    expect(raw.pontos[index + 1].timestamp > raw.pontos[index].timestamp).toBe(true);
  });

  it('série da área traz uma série por dispositivo dentro do polígono', async () => {
    const body = (
      await get(`/telemetria?area=${areaId}&grandeza=temperatura&${range}&bucket=1h`).expect(200)
    ).body;
    expect(contract.validate('SerieArea', body).errors).toEqual([]);
    expect(body.series.map((s: { slug: string }) => s.slug).sort()).toEqual(['termo-a', 'termo-b']);
    const a = body.series.find((s: { slug: string }) => s.slug === 'termo-a');
    expect(a.pontos).toHaveLength(2);
  });

  it('recusa bucket desconhecido, intervalo invertido e área de fora do inquilino', async () => {
    await get(`/dispositivos/${devices['termo-a']!.id}/telemetria?bucket=5m`).expect(400);
    await get(
      `/dispositivos/${devices['termo-a']!.id}/telemetria?de=2026-10-21T00:00:00Z&ate=2026-10-20T00:00:00Z`,
    ).expect(400);
    await get(`/telemetria?area=${randomUUID()}`).expect(404);
    await get('/telemetria').expect(400);
  });
});
