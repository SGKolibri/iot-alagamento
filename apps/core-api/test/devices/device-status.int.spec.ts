import { buildMessages } from '@iot/simulators';
import request from 'supertest';
import { DeviceStatusSweeper } from '../../src/devices/device-status';
import { createTenant, startTestApp, type TestApp } from '../support/app';

const TENANT = 'inquilino-estado';

async function eventually<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida no prazo');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('9. estado do dispositivo (RF-DIS-06)', () => {
  let t: TestApp;
  let device: { id: string; credencial: string };

  const row = async () =>
    (
      await t.db.query<{ status: string; last_contact_at: Date | null }>(
        'SELECT status, last_contact_at FROM devices WHERE id = $1',
        [device.id],
      )
    ).rows[0]!;
  const statusEvents = async () =>
    (await t.redis.xrange('device.status_changed', '-', '+'))
      .map(([, fields]) => JSON.parse(fields[1]!) as { deviceId: string; from: string; to: string })
      .filter((e) => e.deviceId === device.id);
  const ingest = (timestamp: Date) =>
    request(t.app.getHttpServer())
      .post('/api/v1/ingestao')
      .set('Authorization', `Bearer ${device.credencial}`)
      .send(
        buildMessages({
          tenant: TENANT,
          site: 's',
          domain: 'd',
          device: 'medidor',
          quantity: 'temperatura',
          unit: 'Cel',
          initialValue: 20,
          step: 0,
          count: 1,
          intervalMs: 1,
          start: timestamp,
        })[0],
      )
      .expect(202);

  beforeAll(async () => {
    // Intervalo longo: a varredura automática não interfere; o teste chama sweep() direto.
    t = await startTestApp({ DEVICE_STATUS_SWEEP_MS: '3600000' });
    await createTenant(t.db, TENANT);
    const api = (path: string, body: object) =>
      request(t.app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('X-Tenant', TENANT)
        .send(body)
        .expect(201);
    const dominio = (await api('/catalogo/dominios', { slug: 'd', nome: 'D' })).body;
    const perfil = (
      await api('/perfis', {
        dominio_id: dominio.id,
        nome: 'p',
        intervalo_esperado_s: 60,
        grandezas: [{ nome: 'temperatura', unidade: 'Cel' }],
      })
    ).body;
    const site = (await api('/sites', { slug: 's', nome: 'S' })).body;
    device = (
      await api('/dispositivos', { slug: 'medidor', perfil_id: perfil.id, site_id: site.id })
    ).body;
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  it('medição ingerida atualiza lastContactAt e deixa o dispositivo ONLINE; a atrasada não mexe', async () => {
    expect(await row()).toEqual({ status: 'NUNCA_CONECTADO', last_contact_at: null });
    const measuredAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await ingest(measuredAt);
    const updated = await eventually(async () => {
      const current = await row();
      return current.status === 'ONLINE' ? current : undefined;
    });
    expect(updated.last_contact_at?.toISOString()).toBe(measuredAt.toISOString());

    await ingest(new Date(measuredAt.getTime() - 3_600_000));
    await new Promise((r) => setTimeout(r, 1000));
    expect((await row()).last_contact_at?.toISOString()).toBe(measuredAt.toISOString());
  });

  it('evento repetido no barramento não muda nada', async () => {
    const before = await row();
    const [last] = await t.redis.xrevrange('measurement.ingested', '+', '-', 'COUNT', 1);
    await t.redis.xadd('measurement.ingested', '*', ...last![1]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await row()).toEqual(before);
    expect(await statusEvents()).toEqual([
      expect.objectContaining({ from: 'NUNCA_CONECTADO', to: 'ONLINE' }),
    ]);
  });

  it('a varredura marca SEM_SINAL e publica device.status_changed uma única vez', async () => {
    const sweeper = t.app.get(DeviceStatusSweeper);
    const lastContact = (await row()).last_contact_at!;
    const justBefore = new Date(lastContact.getTime() + 180_000);
    const after = new Date(lastContact.getTime() + 181_000);

    expect(await sweeper.sweep(justBefore)).toEqual([]);
    expect((await row()).status).toBe('ONLINE');

    expect(await sweeper.sweep(after)).toEqual([device.id]);
    expect(await sweeper.sweep(after)).toEqual([]);
    expect((await row()).status).toBe('SEM_SINAL');
    const events = await statusEvents();
    expect(events.filter((e) => e.to === 'SEM_SINAL')).toEqual([
      expect.objectContaining({ deviceId: device.id, from: 'ONLINE', to: 'SEM_SINAL' }),
    ]);
  });

  it('dado atrasado não tira do SEM_SINAL; dado atual volta a ONLINE com um evento só', async () => {
    await ingest(new Date(Date.now() - 2 * 3_600_000));
    await new Promise((r) => setTimeout(r, 1000));
    expect((await row()).status).toBe('SEM_SINAL');

    await ingest(new Date(Math.floor(Date.now() / 1000) * 1000 + 1000));
    await eventually(async () => ((await row()).status === 'ONLINE' ? true : undefined));
    const recoveries = (await statusEvents()).filter((e) => e.from === 'SEM_SINAL');
    expect(recoveries).toEqual([expect.objectContaining({ to: 'ONLINE' })]);
  });
});
