import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';

const TENANT = 'inquilino-regras';

const levelRule = (overrides: Record<string, unknown> = {}) => ({
  nome: 'nível alto',
  escopo: 'central',
  ativa: true,
  condicao: { grandeza: 'nivel', operador: '>=', limite: 100, duracao: { leituras: 3 } },
  acoes: [{ tipo: 'gerar_alarme', severidade: 'alta' }],
  ...overrides,
});

describe('regras e alarmes (T1d)', () => {
  let t: TestApp;
  let contract: ResponseValidator;

  const api = () => request(t.app.getHttpServer());
  const as = (tenant: string) => ({
    get: (path: string) => api().get(`/api/v1${path}`).set('X-Tenant', tenant),
    post: (path: string, body: object) =>
      api().post(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
    patch: (path: string, body: object) =>
      api().patch(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
  });
  const a = () => as(TENANT);

  beforeAll(async () => {
    contract = await createResponseValidator();
    t = await startTestApp();
    await createTenant(t.db, TENANT);
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  describe('API de regras (RF-PRO-02)', () => {
    it('cria na versão 1, valida pelo contrato e lê de volta', async () => {
      const created = await a().post('/regras', levelRule()).expect(201);
      expect(contract.validate('Regra', created.body).errors).toEqual([]);
      expect(created.body).toMatchObject({ versao: 1, ...levelRule() });

      const read = await a().get(`/regras/${created.body.id}`).expect(200);
      expect(read.body).toEqual(created.body);
    });

    it('regra fora do schema é recusada com o campo', async () => {
      const response = await a()
        .post('/regras', { ...levelRule(), acoes: undefined })
        .expect(400);
      expect(contract.validate('Erro', response.body).errors).toEqual([]);
      expect(response.body.detalhes).toContainEqual(expect.objectContaining({ regra: 'required' }));
    });

    it('cada alteração sobe a versão; a regra resultante passa pelo schema', async () => {
      const { body: rule } = await a()
        .post('/regras', levelRule({ nome: 'para alterar' }))
        .expect(201);
      const first = await a().patch(`/regras/${rule.id}`, { ativa: false }).expect(200);
      expect(first.body).toMatchObject({ versao: 2, ativa: false, nome: 'para alterar' });
      const second = await a()
        .patch(`/regras/${rule.id}`, { acoes: [{ tipo: 'gerar_alarme', severidade: 'critica' }] })
        .expect(200);
      expect(second.body.versao).toBe(3);
      expect(contract.validate('Regra', second.body).errors).toEqual([]);

      // Ausência com gerar_alarme é proibida pelo schema da regra inteira.
      await a()
        .patch(`/regras/${rule.id}`, { condicao: { ausencia: { intervalos: 3 } } })
        .expect(400);
      await a().patch(`/regras/${rule.id}`, {}).expect(400);
      expect((await a().get(`/regras/${rule.id}`).expect(200)).body.versao).toBe(3);
    });

    it('lista com filtros de escopo e ativa', async () => {
      await a()
        .post('/regras', levelRule({ nome: 'na borda', escopo: 'borda' }))
        .expect(201);
      const edge = await a().get('/regras?escopo=borda').expect(200);
      expect(contract.validate('PaginaRegras', edge.body).errors).toEqual([]);
      expect(edge.body.itens.map((r: { nome: string }) => r.nome)).toEqual(['na borda']);
      const inactive = await a().get('/regras?ativa=false').expect(200);
      expect(inactive.body.itens.map((r: { nome: string }) => r.nome)).toEqual(['para alterar']);
      await a().get('/regras?escopo=lua').expect(400);
    });

    it('id desconhecido ou fora do formato responde 404', async () => {
      await a().get('/regras/00000000-0000-4000-8000-000000000000').expect(404);
      await a().get('/regras/abc').expect(404);
    });
  });
});
