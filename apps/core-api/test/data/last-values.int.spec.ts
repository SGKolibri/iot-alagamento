import { randomUUID } from 'node:crypto';
import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';

const TENANT = 'inquilino-ultimo';
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

async function eventually<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida no prazo');
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Device {
  id: string;
  slug: string;
  credencial: string;
}

describe('último valor (RF-DAD-02)', () => {
  let t: TestApp;
  let contract: ResponseValidator;
  let areaId: string;
  let siteId: string;
  let domainId: string;
  const devices: Record<string, Device> = {};

  const api = () => request(t.app.getHttpServer());
  const ingest = (device: Device, timestamp: Date, medidas: object[]) =>
    api()
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${device.credencial}`)
      .send({
        versao: '1.0',
        id_mensagem: randomUUID(),
        dispositivo: device.slug,
        tipo: 'telemetria',
        timestamp: timestamp.toISOString(),
        medidas,
      })
      .expect(202);
  const lastState = async (device: Device) =>
    (
      await api()
        .get(`/api/v1/dispositivos/${device.id}/ultimo-estado`)
        .set('X-Tenant', TENANT)
        .expect(200)
    ).body;
  const quantity = (
    state: { grandezas: ({ grandeza: string } & Record<string, unknown>)[] },
    name: string,
  ) => state.grandezas.find((g) => g.grandeza === name);

  beforeAll(async () => {
    contract = await createResponseValidator();
    t = await startTestApp();
    await createTenant(t.db, TENANT);
    const post = async (path: string, body: object) =>
      (await api().post(`/api/v1${path}`).set('X-Tenant', TENANT).send(body).expect(201)).body;
    const dominio = await post('/catalogo/dominios', { slug: 'clima', nome: 'Clima' });
    domainId = dominio.id;
    const perfil = await post('/perfis', {
      dominio_id: dominio.id,
      nome: 'estação',
      intervalo_esperado_s: 60,
      grandezas: [
        { nome: 'temperatura', unidade: 'Cel' },
        { nome: 'umidade', unidade: '%' },
      ],
    });
    const site = await post('/sites', { slug: 'campo', nome: 'Campo' });
    siteId = site.id;
    areaId = (
      await post('/areas', {
        site_id: site.id,
        slug: 'quadra',
        nome: 'Quadra',
        geometria: square(-48, -16, 1),
      })
    ).id;
    for (const [slug, coordinates] of [
      ['estacao-a', [-47.5, -15.5]],
      ['estacao-b', [-47.2, -15.2]],
      ['estacao-fora', [-46, -15.5]],
    ] as const) {
      devices[slug] = await post('/dispositivos', {
        slug,
        perfil_id: perfil.id,
        site_id: site.id,
        localizacao: { type: 'Point', coordinates },
      });
    }
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  it('1. medição mais antiga que a guardada não sobrescreve, no Redis nem na tabela', async () => {
    const device = devices['estacao-a']!;
    const newer = new Date(Math.floor(Date.now() / 1000) * 1000);
    const older = new Date(newer.getTime() - 30_000);
    await ingest(device, newer, [{ grandeza: 'temperatura', valor: 25, unidade: 'Cel' }]);
    await eventually(async () =>
      quantity(await lastState(device), 'temperatura') ? true : undefined,
    );
    await ingest(device, older, [{ grandeza: 'temperatura', valor: 10, unidade: 'Cel' }]);
    await new Promise((r) => setTimeout(r, 1500));

    const state = await lastState(device);
    expect(contract.validate('UltimoEstadoDispositivo', state).errors).toEqual([]);
    expect(quantity(state, 'temperatura')).toMatchObject({
      valor: 25,
      unidade: 'Cel',
      timestamp: newer.toISOString(),
      atrasada: false,
    });
    expect(state).toMatchObject({ dispositivo_id: device.id, slug: 'estacao-a', estado: 'ONLINE' });
    const { rows } = await t.db.query(
      'SELECT value, ts FROM last_values WHERE device_id = $1 AND quantity = $2',
      [device.id, 'temperatura'],
    );
    expect(rows).toEqual([{ value: 25, ts: newer }]);
  });

  it('medição atrasada entra no último valor quando é a mais nova guardada, marcada como atrasada', async () => {
    const device = devices['estacao-a']!;
    const late = new Date(Date.now() - 3_600_000);
    await ingest(device, late, [{ grandeza: 'umidade', valor: 70, unidade: '%' }]);
    const humidity = await eventually(async () => quantity(await lastState(device), 'umidade'));
    expect(humidity).toMatchObject({ valor: 70, atrasada: true });
  });

  it('2. evento repetido no barramento não altera o último valor', async () => {
    const device = devices['estacao-a']!;
    const before = (
      await t.db.query('SELECT * FROM last_values WHERE device_id = $1 ORDER BY quantity', [
        device.id,
      ])
    ).rows;
    const entries = await t.redis.xrange('measurement.ingested', '-', '+');
    const first = entries.find(([, fields]) => fields[1]!.includes(device.id))!;
    await t.redis.xadd('measurement.ingested', '*', ...first[1]);
    await new Promise((r) => setTimeout(r, 1500));
    const after = (
      await t.db.query('SELECT * FROM last_values WHERE device_id = $1 ORDER BY quantity', [
        device.id,
      ])
    ).rows;
    expect(after).toEqual(before);
    expect(quantity(await lastState(device), 'temperatura')?.valor).toBe(25);
  });

  it('3. a lista filtra por área e respeita a paginação padrão', async () => {
    const now = new Date();
    await ingest(devices['estacao-b']!, now, [
      { grandeza: 'temperatura', valor: 22, unidade: 'Cel' },
    ]);
    await ingest(devices['estacao-fora']!, now, [
      { grandeza: 'temperatura', valor: 30, unidade: 'Cel' },
    ]);
    await eventually(async () => {
      const { rows } = await t.db.query(
        'SELECT count(DISTINCT device_id)::int AS n FROM last_values',
      );
      return rows[0].n === 3 ? true : undefined;
    });
    const list = (query: string) =>
      api()
        .get(`/api/v1/ultimo-estado?${query}`)
        .set('X-Tenant', TENANT)
        .expect(200)
        .then((r) => r.body);

    const first = await list(`area=${areaId}&limite=1&ordenar=slug`);
    expect(contract.validate('PaginaUltimoEstado', first).errors).toEqual([]);
    expect(first).toMatchObject({ pagina: 1, limite: 1, total: 2 });
    expect(first.itens.map((i: { slug: string }) => i.slug)).toEqual(['estacao-a']);
    const second = await list(`area=${areaId}&limite=1&ordenar=slug&pagina=2`);
    expect(second.itens.map((i: { slug: string }) => i.slug)).toEqual(['estacao-b']);

    const all = await list(`site=${siteId}&dominio=${domainId}&ordenar=-slug`);
    expect(all.itens.map((i: { slug: string }) => i.slug)).toEqual([
      'estacao-fora',
      'estacao-b',
      'estacao-a',
    ]);
    expect((await list('estado=SEM_SINAL')).total).toBe(0);
    await api().get('/api/v1/ultimo-estado?ordenar=senha').set('X-Tenant', TENANT).expect(400);
  });

  it('dispositivo de outro inquilino ou inexistente responde 404', async () => {
    await api()
      .get(`/api/v1/dispositivos/${randomUUID()}/ultimo-estado`)
      .set('X-Tenant', TENANT)
      .expect(404);
  });
});
