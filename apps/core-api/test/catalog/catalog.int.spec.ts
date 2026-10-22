import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import request from 'supertest';
import { createTenant, startTestApp, type TestApp } from '../support/app';

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

const quantities = [
  { nome: 'distancia_agua', unidade: 'cm', faixa: { min: 0, max: 400 } },
  {
    nome: 'nivel_agua',
    unidade: 'cm',
    expressao: 'atributos.altura_instalacao_cm - distancia_agua',
  },
  { nome: 'bateria', unidade: 'mV' },
];

interface Catalog {
  dominio: { id: string };
  perfil: { id: string; versao: number };
  site: { id: string };
  area: { id: string };
  dispositivo: Record<string, unknown> & { id: string; credencial: string };
  regra: { id: string };
  alarme: { id: string };
}

describe('catálogo por API (Testcontainers)', () => {
  let t: TestApp;
  let contract: ResponseValidator;
  const http = () => request(t.app.getHttpServer());
  const as = (tenant: string) => ({
    post: (path: string, body: object) =>
      http().post(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
    patch: (path: string, body: object) =>
      http().patch(`/api/v1${path}`).set('X-Tenant', tenant).send(body),
    get: (path: string) => http().get(`/api/v1${path}`).set('X-Tenant', tenant),
  });

  async function createCatalog(tenant: string, prefix = ''): Promise<Catalog> {
    const api = as(tenant);
    const dominio = (
      await api.post('/catalogo/dominios', { slug: `${prefix}agua`, nome: 'Água' }).expect(201)
    ).body;
    const perfil = (
      await api
        .post('/perfis', {
          dominio_id: dominio.id,
          nome: 'nível',
          intervalo_esperado_s: 60,
          grandezas: quantities,
        })
        .expect(201)
    ).body;
    const site = (
      await api
        .post('/sites', { slug: `${prefix}centro`, nome: 'Centro', geometria: square(-49, -17, 1) })
        .expect(201)
    ).body;
    const area = (
      await api
        .post('/areas', {
          site_id: site.id,
          slug: `${prefix}corrego`,
          nome: 'Córrego',
          geometria: square(-49, -17, 0.1),
        })
        .expect(201)
    ).body;
    const dispositivo = (
      await api
        .post('/dispositivos', {
          slug: `${prefix}nivel-01`,
          perfil_id: perfil.id,
          site_id: site.id,
          area_id: area.id,
          fabricante: 'Exemplo',
          firmware: '1.0.0',
          atributos: { altura_instalacao_cm: 300 },
          tags: ['piloto'],
          localizacao: { type: 'Point', coordinates: [-48.95, -16.95] },
          credencial_expira_em: '2030-01-01T00:00:00Z',
        })
        .expect(201)
    ).body;
    const regra = (
      await api
        .post('/regras', {
          nome: 'nível alto na área',
          escopo: 'central',
          ativa: true,
          condicao: { grandeza: 'distancia_agua', operador: '<', limite: 50, area_id: area.id },
          acoes: [{ tipo: 'gerar_alarme', severidade: 'alta' }],
        })
        .expect(201)
    ).body;
    // Alarme gravado direto no banco: o motor que os abre tem teste próprio (test/rules).
    const { rows } = await t.db.query<{ id: string }>(
      `INSERT INTO alarms (id, tenant_id, rule_id, rule_version, device_id, severity, state,
                           occurred_at, opened_at)
       SELECT gen_random_uuid(), tenant_id, $1, 1, $2, 'alta', 'ATIVO', now(), now()
         FROM rules WHERE id = $1 RETURNING id`,
      [regra.id, dispositivo.id],
    );
    return { dominio, perfil, site, area, dispositivo, regra, alarme: rows[0]! };
  }

  let a: Catalog;

  beforeAll(async () => {
    contract = await createResponseValidator();
    t = await startTestApp();
    await createTenant(t.db, 'inquilino-a');
    await createTenant(t.db, 'inquilino-b');
    a = await createCatalog('inquilino-a');
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  }, 60_000);

  describe('4. criar e ler de volta com todos os atributos', () => {
    it('dispositivo cadastrado segue o contrato e volta igual na leitura', async () => {
      expect(contract.validate('DispositivoCadastrado', a.dispositivo).errors).toEqual([]);
      expect(a.dispositivo).toMatchObject({
        slug: 'nivel-01',
        perfil_id: a.perfil.id,
        perfil_versao: 1,
        dominio_id: a.dominio.id,
        site_id: a.site.id,
        area_id: a.area.id,
        fabricante: 'Exemplo',
        firmware: '1.0.0',
        atributos: { altura_instalacao_cm: 300 },
        tags: ['piloto'],
        localizacao: { type: 'Point', coordinates: [-48.95, -16.95] },
        estado: 'NUNCA_CONECTADO',
        ultimo_contato_em: null,
        credencial_expira_em: '2030-01-01T00:00:00.000Z',
        credencial_revogada_em: null,
      });
      const read = (await as('inquilino-a').get(`/dispositivos/${a.dispositivo.id}`).expect(200))
        .body;
      const withoutToken: Record<string, unknown> = { ...a.dispositivo };
      delete withoutToken.credencial;
      expect(read).toEqual(withoutToken);
      expect(contract.validate('Dispositivo', read).errors).toEqual([]);
    });

    it.each([
      ['/catalogo/dominios', 'dominio', 'Dominio'],
      ['/perfis', 'perfil', 'Perfil'],
      ['/sites', 'site', 'Site'],
      ['/areas', 'area', 'Area'],
    ] as const)('%s/{id} devolve o item criado, no contrato', async (path, key, schema) => {
      const read = (await as('inquilino-a').get(`${path}/${a[key].id}`).expect(200)).body;
      expect(read).toEqual(a[key]);
      expect(contract.validate(schema, read).errors).toEqual([]);
    });

    it('perfil, site e área guardam grandezas e geometrias', () => {
      expect(a.perfil).toMatchObject({
        versao: 1,
        intervalo_esperado_s: 60,
        grandezas: quantities,
      });
      expect((a.site as unknown as { geometria: unknown }).geometria).toEqual(square(-49, -17, 1));
      expect((a.area as unknown as { geometria: unknown }).geometria).toEqual(
        square(-49, -17, 0.1),
      );
    });

    it('listagens usam pagina, limite e ordenar, no contrato', async () => {
      const api = as('inquilino-a');
      await api.post('/catalogo/dominios', { slug: 'b-ar', nome: 'Ar' }).expect(201);
      await api.post('/catalogo/dominios', { slug: 'c-solo', nome: 'Solo' }).expect(201);
      const page = (await api.get('/catalogo/dominios?limite=2&ordenar=-slug').expect(200)).body;
      expect(page).toMatchObject({ pagina: 1, limite: 2, total: 3 });
      expect(page.itens.map((d: { slug: string }) => d.slug)).toEqual(['c-solo', 'b-ar']);
      expect(contract.validate('PaginaDominios', page).errors).toEqual([]);

      for (const [path, schema] of [
        ['/perfis', 'PaginaPerfis'],
        ['/sites', 'PaginaSites'],
        [`/sites/${a.site.id}/areas`, 'PaginaAreas'],
        ['/dispositivos', 'PaginaDispositivos'],
      ]) {
        const list = (await api.get(path!).expect(200)).body;
        expect(list.total).toBe(1);
        expect(contract.validate(schema!, list).errors).toEqual([]);
      }
      const invalid = (await api.get('/dispositivos?ordenar=credencial_hash').expect(400)).body;
      expect(invalid.detalhes).toEqual([expect.objectContaining({ caminho: 'ordenar' })]);
    });

    it('alterar grandezas sobe a versão do perfil; alterar só o nome não; o dispositivo guarda a versão do cadastro', async () => {
      const api = as('inquilino-a');
      const changed = (
        await api
          .patch(`/perfis/${a.perfil.id}`, {
            grandezas: [...quantities, { nome: 'temperatura', unidade: 'Cel' }],
          })
          .expect(200)
      ).body;
      expect(changed.versao).toBe(2);
      const renamed = (
        await api.patch(`/perfis/${a.perfil.id}`, { nome: 'outro nome' }).expect(200)
      ).body;
      expect(renamed).toMatchObject({ versao: 2, nome: 'outro nome' });
      const device = (await api.get(`/dispositivos/${a.dispositivo.id}`).expect(200)).body;
      expect(device.perfil_versao).toBe(1);
    });

    it('alterações de domínio, site, área e dispositivo voltam na leitura', async () => {
      const api = as('inquilino-a');
      await api.patch(`/catalogo/dominios/${a.dominio.id}`, { nome: 'Água e esgoto' }).expect(200);
      await api.patch(`/sites/${a.site.id}`, { nome: 'Centro novo' }).expect(200);
      await api.patch(`/areas/${a.area.id}`, { geometria: square(-49, -17, 0.2) }).expect(200);
      await api
        .patch(`/dispositivos/${a.dispositivo.id}`, { firmware: '1.1.0', tags: ['piloto', 'rua'] })
        .expect(200);
      expect((await api.get(`/catalogo/dominios/${a.dominio.id}`)).body.nome).toBe('Água e esgoto');
      expect((await api.get(`/sites/${a.site.id}`)).body.nome).toBe('Centro novo');
      expect((await api.get(`/areas/${a.area.id}`)).body.geometria).toEqual(square(-49, -17, 0.2));
      expect((await api.get(`/dispositivos/${a.dispositivo.id}`)).body).toMatchObject({
        firmware: '1.1.0',
        tags: ['piloto', 'rua'],
      });
    });

    it('recusa perfil inválido, corpo fora do contrato e slug repetido', async () => {
      const api = as('inquilino-a');
      const inverted = await api
        .post('/perfis', {
          dominio_id: a.dominio.id,
          nome: 'x',
          intervalo_esperado_s: 60,
          grandezas: [{ nome: 'x', unidade: 'cm', faixa: { min: 10, max: 1 } }],
        })
        .expect(400);
      expect(inverted.body.detalhes).toEqual([
        {
          caminho: '/grandezas/0/faixa',
          regra: 'faixa',
          mensagem: 'o mínimo (10) é maior que o máximo (1)',
        },
      ]);
      const dangerous = await api
        .post('/perfis', {
          dominio_id: a.dominio.id,
          nome: 'x',
          intervalo_esperado_s: 60,
          grandezas: [{ nome: 'x', unidade: 'cm', expressao: 'process.exit()' }],
        })
        .expect(400);
      expect(dangerous.body.detalhes[0]).toMatchObject({ caminho: '/grandezas/0/expressao' });
      const outside = await api.post('/catalogo/dominios', { slug: 'x' }).expect(400);
      expect(outside.body.detalhes).toContainEqual(
        expect.objectContaining({ caminho: '/nome', regra: 'required' }),
      );
      const duplicate = await api
        .post('/catalogo/dominios', { slug: 'agua', nome: 'de novo' })
        .expect(409);
      expect(duplicate.body.codigo).toBe('conflito');
    });
  });

  describe('5. credencial mostrada uma única vez', () => {
    it('o token só aparece no cadastro, e o banco guarda outro valor', async () => {
      const token = a.dispositivo.credencial;
      const [credentialId, secret] = token.split('.');
      const list = (await as('inquilino-a').get('/dispositivos')).body;
      expect(JSON.stringify(list)).not.toContain(secret!);
      expect(
        JSON.stringify((await as('inquilino-a').get(`/dispositivos/${a.dispositivo.id}`)).body),
      ).not.toContain(secret!);
      const { rows } = await t.db.query(
        'SELECT credential_id, credential_hash, credential_salt FROM devices WHERE id = $1',
        [a.dispositivo.id],
      );
      expect(rows[0].credential_id).toBe(credentialId);
      expect(rows[0].credential_hash).not.toBe(token);
      expect(rows[0].credential_hash).not.toContain(secret!);
      expect(rows[0].credential_salt).toHaveLength(22);
    });
  });

  describe('8. consulta espacial por área (RF-CEN-04)', () => {
    it('devolve exatamente os dispositivos dentro do polígono, inclusive o ponto sobre a borda', async () => {
      const api = as('inquilino-a');
      const site = (await api.post('/sites', { slug: 'espacial', nome: 'Espacial' }).expect(201))
        .body;
      const area = (
        await api
          .post('/areas', {
            site_id: site.id,
            slug: 'quadra',
            nome: 'Quadra',
            geometria: square(-48, -16, 1),
          })
          .expect(201)
      ).body;
      const device = async (slug: string, coordinates: number[], areaId?: string) =>
        (
          await api
            .post('/dispositivos', {
              slug,
              perfil_id: a.perfil.id,
              site_id: site.id,
              ...(areaId ? { area_id: areaId } : {}),
              localizacao: { type: 'Point', coordinates },
            })
            .expect(201)
        ).body;
      await device('dentro', [-47.5, -15.5]);
      await device('na-borda', [-48, -15.5]);
      await device('fora', [-46.9, -15.5]);
      await device('ligado-mas-fora', [-50, -20], area.id);
      await device('dentro-sem-area', [-47.1, -15.1]);

      const result = (await api.get(`/areas/${area.id}/dispositivos?ordenar=slug`).expect(200))
        .body;
      expect(result.itens.map((d: { slug: string }) => d.slug)).toEqual([
        'dentro',
        'dentro-sem-area',
        'na-borda',
      ]);
      expect(result.total).toBe(3);
      expect(contract.validate('PaginaDispositivos', result).errors).toEqual([]);
    });
  });

  describe('7. isolamento entre inquilinos', () => {
    it('sem X-Tenant, ou com inquilino desconhecido, responde 401 no esquema Erro', async () => {
      const missing = await http().get('/api/v1/sites').expect(401);
      expect(contract.validate('Erro', missing.body).errors).toEqual([]);
      await http().get('/api/v1/sites').set('X-Tenant', 'nao-existe').expect(401);
    });

    it('o inquilino B não lê nem altera nada do A em nenhuma rota do catálogo nem da série', async () => {
      const b = as('inquilino-b');
      const routes: [string, string, () => Promise<unknown>][] = [
        [
          'GET',
          '/api/v1/catalogo/dominios/:id',
          () => b.get(`/catalogo/dominios/${a.dominio.id}`).expect(404),
        ],
        [
          'PATCH',
          '/api/v1/catalogo/dominios/:id',
          () => b.patch(`/catalogo/dominios/${a.dominio.id}`, { nome: 'x' }).expect(404),
        ],
        ['GET', '/api/v1/perfis/:id', () => b.get(`/perfis/${a.perfil.id}`).expect(404)],
        [
          'PATCH',
          '/api/v1/perfis/:id',
          () => b.patch(`/perfis/${a.perfil.id}`, { nome: 'x' }).expect(404),
        ],
        ['GET', '/api/v1/sites/:id', () => b.get(`/sites/${a.site.id}`).expect(404)],
        [
          'PATCH',
          '/api/v1/sites/:id',
          () => b.patch(`/sites/${a.site.id}`, { nome: 'x' }).expect(404),
        ],
        ['GET', '/api/v1/sites/:id/areas', () => b.get(`/sites/${a.site.id}/areas`).expect(404)],
        ['GET', '/api/v1/areas/:id', () => b.get(`/areas/${a.area.id}`).expect(404)],
        [
          'PATCH',
          '/api/v1/areas/:id',
          () => b.patch(`/areas/${a.area.id}`, { nome: 'x' }).expect(404),
        ],
        [
          'GET',
          '/api/v1/areas/:id/dispositivos',
          () => b.get(`/areas/${a.area.id}/dispositivos`).expect(404),
        ],
        [
          'GET',
          '/api/v1/dispositivos/:id',
          () => b.get(`/dispositivos/${a.dispositivo.id}`).expect(404),
        ],
        [
          'PATCH',
          '/api/v1/dispositivos/:id',
          () => b.patch(`/dispositivos/${a.dispositivo.id}`, { firmware: 'x' }).expect(404),
        ],
        [
          'POST',
          '/api/v1/dispositivos/:id/credenciais/revogar',
          () => b.post(`/dispositivos/${a.dispositivo.id}/credenciais/revogar`, {}).expect(404),
        ],
        [
          'GET',
          '/api/v1/dispositivos/:id/telemetria',
          () => b.get(`/dispositivos/${a.dispositivo.id}/telemetria`).expect(404),
        ],
        [
          'GET',
          '/api/v1/dispositivos/:id/ultimo-estado',
          () => b.get(`/dispositivos/${a.dispositivo.id}/ultimo-estado`).expect(404),
        ],
        ['GET', '/api/v1/telemetria', () => b.get(`/telemetria?area=${a.area.id}`).expect(404)],
        ['GET', '/api/v1/ultimo-estado', async () => expectEmpty(await b.get('/ultimo-estado'))],
        [
          'GET',
          '/api/v1/catalogo/dominios',
          async () => expectEmpty(await b.get('/catalogo/dominios')),
        ],
        ['GET', '/api/v1/perfis', async () => expectEmpty(await b.get('/perfis'))],
        ['GET', '/api/v1/sites', async () => expectEmpty(await b.get('/sites'))],
        ['GET', '/api/v1/areas', async () => expectEmpty(await b.get('/areas'))],
        ['GET', '/api/v1/dispositivos', async () => expectEmpty(await b.get('/dispositivos'))],
        ['GET', '/api/v1/regras/:id', () => b.get(`/regras/${a.regra.id}`).expect(404)],
        [
          'PATCH',
          '/api/v1/regras/:id',
          () => b.patch(`/regras/${a.regra.id}`, { nome: 'x' }).expect(404),
        ],
        ['GET', '/api/v1/regras', async () => expectEmpty(await b.get('/regras'))],
        ['GET', '/api/v1/alarmes/:id', () => b.get(`/alarmes/${a.alarme.id}`).expect(404)],
        [
          'PATCH',
          '/api/v1/alarmes/:id/reconhecer',
          () => b.patch(`/alarmes/${a.alarme.id}/reconhecer`, {}).set('X-Ator', 'op-b').expect(404),
        ],
        [
          'PATCH',
          '/api/v1/alarmes/:id/resolver',
          () =>
            b
              .patch(`/alarmes/${a.alarme.id}/resolver`, { motivo: 'x' })
              .set('X-Ator', 'op-b')
              .expect(404),
        ],
        ['GET', '/api/v1/alarmes', async () => expectEmpty(await b.get('/alarmes'))],
        // Criar no B apontando para ids do A é recusado como referência inexistente.
        [
          'POST',
          '/api/v1/catalogo/dominios',
          () => b.post('/catalogo/dominios', { slug: 'agua', nome: 'Água do B' }).expect(201),
        ],
        [
          'POST',
          '/api/v1/perfis',
          () =>
            b
              .post('/perfis', {
                dominio_id: a.dominio.id,
                nome: 'x',
                intervalo_esperado_s: 60,
                grandezas: quantities,
              })
              .expect(400),
        ],
        [
          'POST',
          '/api/v1/sites',
          () => b.post('/sites', { slug: 'centro', nome: 'Centro do B' }).expect(201),
        ],
        [
          'POST',
          '/api/v1/areas',
          () =>
            b
              .post('/areas', {
                site_id: a.site.id,
                slug: 'x',
                nome: 'x',
                geometria: square(0, 0, 1),
              })
              .expect(400),
        ],
        [
          'POST',
          '/api/v1/dispositivos',
          () =>
            b
              .post('/dispositivos', { slug: 'x', perfil_id: a.perfil.id, site_id: a.site.id })
              .expect(400),
        ],
        [
          'POST',
          '/api/v1/regras',
          () =>
            b
              .post('/regras', {
                nome: 'x',
                escopo: 'central',
                ativa: true,
                condicao: { grandeza: 'x', operador: '>', limite: 1, area_id: a.area.id },
                acoes: [{ tipo: 'gerar_alarme', severidade: 'baixa' }],
              })
              .expect(400),
        ],
      ];
      for (const [, , call] of routes) await call();

      // Toda rota do app que leva X-Tenant precisa estar na lista acima.
      const covered = new Set(routes.map(([method, path]) => `${method} ${path}`));
      const registered = tenantRoutes(t);
      expect(registered.filter((route) => !covered.has(route))).toEqual([]);

      // O A continua intacto.
      expect(
        (await as('inquilino-a').get(`/catalogo/dominios/${a.dominio.id}`)).body.nome,
      ).not.toBe('x');
    });
  });
});

function expectEmpty(response: request.Response): void {
  expect(response.status).toBe(200);
  expect(response.body.itens).toEqual([]);
  expect(response.body.total).toBe(0);
}

// Rotas registradas no Express, fora as de ingestão (credencial do dispositivo) e o /health.
function tenantRoutes(t: TestApp): string[] {
  const express = t.app.getHttpAdapter().getInstance() as {
    router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return express.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route!.methods).map((m) => `${m.toUpperCase()} ${layer.route!.path}`),
    )
    .filter((route) => route.includes('/api/v1/') && !route.includes('/ingestao'));
}
