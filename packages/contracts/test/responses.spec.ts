import {
  checkContracts,
  createResponseValidator,
  listResponseExamples,
  loadExpectedResponseErrors,
  responseSchemaForExample,
  type ResponseValidator,
} from '../src';

describe('exemplos de resposta contra o OpenAPI (ADR-012)', () => {
  let validator: ResponseValidator;
  beforeAll(async () => {
    validator = await createResponseValidator();
  });

  it('o esquema de cada exemplo sai do nome do arquivo', () => {
    expect(responseSchemaForExample('resultado-lote-x.json')).toBe('ResultadoLote');
    expect(responseSchemaForExample('resultado-mensagem-x.json')).toBe('ResultadoMensagem');
    expect(() => responseSchemaForExample('outro.json')).toThrow('outro.json');
  });

  it.each(listResponseExamples('valid').map((e) => [e.file, e.data] as const))(
    'aceita %s',
    (file, data) => {
      const result = validator.validate(responseSchemaForExample(file), data);
      expect(result.errors).toEqual([]);
    },
  );

  it('todo exemplo inválido tem erro esperado declarado, e vice-versa', () => {
    expect(
      listResponseExamples('invalid')
        .map((e) => e.file)
        .sort(),
    ).toEqual(Object.keys(loadExpectedResponseErrors()).sort());
  });

  it.each(listResponseExamples('invalid').map((e) => [e.file, e.data] as const))(
    'rejeita %s com o erro esperado',
    (file, data) => {
      const rule = loadExpectedResponseErrors()[file]!;
      const result = validator.validate(rule.esquema, data);
      expect(result.valid).toBe(false);
      const match: Record<string, unknown> = { path: rule.caminho, keyword: rule.regra };
      if (rule.campo_ausente) match.params = { missingProperty: rule.campo_ausente };
      expect(result.errors).toContainEqual(expect.objectContaining(match));
    },
  );

  it('esquema inexistente no OpenAPI é erro de uso', () => {
    expect(() => validator.validate('Inexistente', {})).toThrow('Inexistente');
  });

  it('pnpm contracts:validate inclui os exemplos de resposta', async () => {
    const results = await checkContracts();
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'responses/valid/resultado-lote-com-recusada-sem-id.json',
        'responses/invalid/resultado-mensagem-sem-indice.json',
      ]),
    );
  });
});
