import { join } from 'node:path';
import { MemoryDeviceDirectory } from './memory-device-directory';

const fixture = join(__dirname, '../../../test/fixtures/device-directory.json');

describe('MemoryDeviceDirectory (fixture até a T1b)', () => {
  const env = { TEST_SENSOR_A_TOKEN: 'segredo-a', TEST_EDGE_TOKEN: 'segredo-borda' };
  const directory = MemoryDeviceDirectory.fromFile(fixture, env);

  it('encontra o dispositivo pelo inquilino e pelo slug, com perfil, local e atributos', async () => {
    const device = await directory.findDevice('inquilino-teste', 'sensor-a');
    expect(device).toEqual({
      id: 'd0000000-0000-4000-8000-000000000001',
      slug: 'sensor-a',
      tenantId: 'a0000000-0000-4000-8000-000000000001',
      tenantSlug: 'inquilino-teste',
      site: 'site-teste',
      domain: 'dominio-teste',
      location: { site: 'site-teste', area: 'area-1' },
      attributes: { altura_cm: 300 },
      profile: {
        expectedIntervalSeconds: 60,
        quantities: [{ name: 'temperatura', unit: 'Cel', range: { min: -20, max: 60 } }],
      },
    });
  });

  it('devolve null para dispositivo ou inquilino desconhecido', async () => {
    expect(await directory.findDevice('inquilino-teste', 'x')).toBeNull();
    expect(await directory.findDevice('x', 'sensor-a')).toBeNull();
  });

  it('autentica a credencial do dispositivo e a do nó de borda, lidas do ambiente', async () => {
    expect(await directory.authenticate('segredo-a')).toEqual({
      kind: 'device',
      tenantSlug: 'inquilino-teste',
      deviceSlug: 'sensor-a',
    });
    expect(await directory.authenticate('segredo-borda')).toEqual({
      kind: 'edge',
      tenantSlug: 'inquilino-teste',
      nodeId: 'borda-teste',
    });
    expect(await directory.authenticate('outro')).toBeNull();
  });

  it('dispositivo sem variável de credencial definida não autentica por HTTP', async () => {
    const empty = MemoryDeviceDirectory.fromFile(fixture, {});
    expect(await empty.authenticate('')).toBeNull();
    expect(await empty.authenticate('segredo-a')).toBeNull();
  });
});
