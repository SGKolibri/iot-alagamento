import { ListQueryError, parseListQuery } from './list-query';

const sortable = { slug: 'slug', criado_em: 'createdAt' };

describe('parâmetros comuns de listagem (RF-APP-07)', () => {
  it('usa os padrões do OpenAPI: página 1, limite 50 e a ordenação padrão', () => {
    expect(parseListQuery({}, { sortable, defaultSort: 'slug' })).toEqual({
      page: 1,
      limit: 50,
      offset: 0,
      sort: { field: 'slug', direction: 'asc' },
    });
  });

  it('lê página, limite e ordem decrescente com "-"', () => {
    expect(
      parseListQuery(
        { pagina: '3', limite: '20', ordenar: '-criado_em' },
        { sortable, defaultSort: 'slug' },
      ),
    ).toEqual({ page: 3, limit: 20, offset: 40, sort: { field: 'createdAt', direction: 'desc' } });
  });

  it.each([
    [{ pagina: '0' }, 'pagina', 'precisa ser um inteiro de 1 em diante'],
    [{ pagina: 'x' }, 'pagina', 'precisa ser um inteiro de 1 em diante'],
    [{ limite: '501' }, 'limite', 'precisa ser um inteiro de 1 a 500'],
    [{ limite: '2.5' }, 'limite', 'precisa ser um inteiro de 1 a 500'],
    [
      { ordenar: 'senha' },
      'ordenar',
      'campo de ordenação não permitido: senha (aceitos: slug, criado_em)',
    ],
  ])('recusa %j', (query, path, message) => {
    let error: unknown;
    try {
      parseListQuery(query, { sortable, defaultSort: 'slug' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ListQueryError);
    expect((error as ListQueryError).issues).toEqual([{ path, rule: 'consulta', message }]);
  });
});
