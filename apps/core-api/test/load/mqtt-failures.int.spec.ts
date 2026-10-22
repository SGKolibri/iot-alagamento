import pg from 'pg';
import { startTestApp, type TestApp } from '../support/app';
import { createLoadCatalog, report } from '../support/load-catalog';
import { drain, publishBurst, type LoadTarget } from '../support/mqtt-load';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// RNF-10 sob falhas: nenhuma mensagem confirmada ao publicador some quando o assinante cai ou
// quando o banco fica fora por alguns segundos.
describe('contabilidade MQTT sob falhas (RNF-10)', () => {
  let t: TestApp;
  let target: LoadTarget;

  beforeAll(async () => {
    t = await startTestApp();
    target = await createLoadCatalog(t, 'inquilino-falhas');
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  it('2. o core-api cai no meio da rajada e volta: nada confirmado se perde', async () => {
    const burst = publishBurst(target, 20, 6_000, { ratePerSecond: 1_500 });
    await sleep(1_500);
    await t.crashApp();
    report('assinante derrubado', { em_ms: 1_500 });
    await sleep(1_500);
    await t.startApp();
    const result = await burst;
    const accounting = await drain(t.db, result.confirmed, 60_000);
    report('queda do assinante', { confirmadas: result.confirmed.length, ...accounting });
    expect(result.confirmed).toHaveLength(6_000);
    expect(accounting.missing).toBe(0);
  }, 180_000);

  it('3. o banco fica fora por alguns segundos: nada confirmado se perde e as pendentes entram depois', async () => {
    const admin = new pg.Pool({
      host: t.infra.env.POSTGRES_HOST,
      port: Number(t.infra.env.POSTGRES_PORT),
      user: t.infra.env.POSTGRES_USER,
      password: t.infra.env.POSTGRES_PASSWORD,
      database: t.infra.env.POSTGRES_DB,
      max: 1,
    });
    const keeper = await admin.connect();
    const burst = publishBurst(target, 20, 6_000, { ratePerSecond: 1_000 });
    await sleep(1_500);
    // Queda: o usuário da aplicação não entra mais e as conexões abertas caem.
    await keeper.query(`ALTER ROLE ${t.infra.env.POSTGRES_USER} NOLOGIN`);
    await keeper.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = $1',
      [t.infra.env.POSTGRES_USER],
    );
    report('banco fora', { em_ms: 1_500, por_ms: 4_000 });
    await sleep(4_000);
    await keeper.query(`ALTER ROLE ${t.infra.env.POSTGRES_USER} LOGIN`);
    keeper.release();
    await admin.end();
    const result = await burst;
    const accounting = await drain(t.db, result.confirmed, 60_000);
    report('queda do banco', { confirmadas: result.confirmed.length, ...accounting });
    expect(result.confirmed).toHaveLength(6_000);
    expect(accounting.missing).toBe(0);
  }, 180_000);
});
