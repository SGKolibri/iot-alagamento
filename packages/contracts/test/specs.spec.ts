import { join } from 'node:path';
import { CONTRACTS_DIR, validateAsyncApi, validateOpenApi } from '../src';

const fixtures = join(__dirname, 'fixtures');

describe('AsyncAPI 3 (RNF-13)', () => {
  it('asyncapi.yaml é válido no parser oficial', async () => {
    const result = await validateAsyncApi(join(CONTRACTS_DIR, 'asyncapi.yaml'));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('descreve os quatro tópicos da seção 7 do PRD, com o sentido de cada um', async () => {
    const result = await validateAsyncApi(join(CONTRACTS_DIR, 'asyncapi.yaml'));
    expect(result.channels).toEqual(
      expect.arrayContaining([
        {
          address: '{inquilino}/{site}/{dominio}/{dispositivo}/telemetria',
          parameters: ['inquilino', 'site', 'dominio', 'dispositivo'],
          actions: ['receive'],
        },
        {
          address: '{inquilino}/{site}/{dominio}/{dispositivo}/evento',
          parameters: ['inquilino', 'site', 'dominio', 'dispositivo'],
          actions: ['receive'],
        },
        {
          address: '{inquilino}/{site}/{dominio}/{dispositivo}/estado',
          parameters: ['inquilino', 'site', 'dominio', 'dispositivo'],
          actions: ['receive'],
        },
        {
          address: '{inquilino}/{site}/{dominio}/{dispositivo}/comando',
          parameters: ['inquilino', 'site', 'dominio', 'dispositivo'],
          actions: ['send'],
        },
      ]),
    );
    expect(result.channels).toHaveLength(4);
  });

  it('rejeita um documento AsyncAPI quebrado', async () => {
    const result = await validateAsyncApi(join(fixtures, 'asyncapi-invalido.yaml'));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('OpenAPI 3 (RF-APP-01, RNF-13)', () => {
  it('openapi.yaml é válido no parser oficial', async () => {
    const result = await validateOpenApi(join(CONTRACTS_DIR, 'openapi.yaml'));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('contém os endpoints da tabela REST da seção 7 do PRD', async () => {
    const result = await validateOpenApi(join(CONTRACTS_DIR, 'openapi.yaml'));
    expect(result.operations).toEqual(
      expect.arrayContaining([
        'POST /dispositivos',
        'POST /ingestao',
        'POST /ingestao/lote',
        'GET /dispositivos/{id}/telemetria',
        'GET /dispositivos/{id}/ultimo-estado',
        'PUT /dispositivos/{id}/gemeo/desejado',
        'GET /sites/{id}/areas',
        'POST /catalogo/dominios',
        'POST /perfis',
        'POST /regras',
        'GET /alarmes',
        'PATCH /alarmes/{id}/reconhecer',
        'POST /validador',
        'GET /dados-abertos/{conjunto}',
        'GET /ngsi-ld/v1/entities',
      ]),
    );
  });

  it('declara os esquemas de segurança bearer OIDC e chave de API', async () => {
    const result = await validateOpenApi(join(CONTRACTS_DIR, 'openapi.yaml'));
    expect(result.securitySchemes).toEqual(
      expect.objectContaining({ oidc: 'openIdConnect', chaveApi: 'apiKey' }),
    );
  });

  it('rejeita um documento OpenAPI quebrado', async () => {
    const result = await validateOpenApi(join(fixtures, 'openapi-invalido.yaml'));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
