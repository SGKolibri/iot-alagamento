import { join } from 'node:path';
import { checkContracts, checkExamples } from '../src';

describe('verificação completa dos contratos (pnpm contracts:validate)', () => {
  it('passa com os contratos do repositório', async () => {
    const results = await checkContracts();
    expect(results.filter((r) => !r.ok)).toEqual([]);
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'valid/telemetria-nivel-agua.json',
        'invalid/sem-versao.json',
        'asyncapi.yaml',
        'openapi.yaml',
      ]),
    );
  });

  it('falha quando um exemplo inválido está marcado como válido, e vice-versa', () => {
    const results = checkExamples({ examplesDir: join(__dirname, 'fixtures/exemplo-trocado') });
    expect(results).toEqual([
      expect.objectContaining({
        name: 'invalid/telemetria-sem-erro.json',
        ok: false,
        detail: expect.stringContaining('foi aceito'),
      }),
      expect.objectContaining({
        name: 'valid/telemetria-trocada.json',
        ok: false,
        detail: expect.stringContaining('/timestamp'),
      }),
    ]);
  });

  it('falha quando um exemplo inválido não tem erro esperado declarado', () => {
    const results = checkExamples({ examplesDir: join(__dirname, 'fixtures/sem-expectativa') });
    expect(results).toContainEqual(
      expect.objectContaining({
        name: 'invalid/orfao.json',
        ok: false,
        detail: expect.stringContaining('expected-errors.json'),
      }),
    );
  });
});
