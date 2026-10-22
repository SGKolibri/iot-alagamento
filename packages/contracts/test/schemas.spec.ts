import {
  contractForExample,
  createSchemaValidator,
  listExamples,
  loadExpectedErrors,
  type ContractName,
  type ValidationIssue,
} from '../src';

const validator = createSchemaValidator();
const expected = loadExpectedErrors();

const contractFor = (file: string): ContractName => contractForExample(file);

describe('exemplos válidos são aceitos (RF-INT-01)', () => {
  const valid = listExamples('valid');

  it('existem os exemplos mínimos do handoff', () => {
    const files = valid.map((example) => example.file);
    expect(files).toEqual(
      expect.arrayContaining([
        'telemetria-nivel-agua.json',
        'telemetria-solo-via-borda.json',
        'evento-porta-aberta.json',
        'estado-relatado.json',
        'comando-ligar-irrigacao.json',
        'lote-3-mensagens.json',
      ]),
    );
  });

  it.each(valid.map((example) => [example.file, example.data] as const))('%s', (file, data) => {
    const result = validator.validate(contractFor(file), data);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('o lote de exemplo tem 3 mensagens', () => {
    const lote = valid.find((example) => example.file === 'lote-3-mensagens.json');
    expect((lote?.data as { mensagens: unknown[] }).mensagens).toHaveLength(3);
  });
});

describe('exemplos inválidos são rejeitados com o erro esperado (RF-INT-01)', () => {
  const invalid = listExamples('invalid');

  it('todo exemplo inválido tem um erro esperado declarado, e vice-versa', () => {
    expect(invalid.map((example) => example.file).sort()).toEqual(Object.keys(expected).sort());
  });

  it('existem os inválidos mínimos do handoff', () => {
    expect(Object.keys(expected)).toEqual(
      expect.arrayContaining([
        'sem-versao.json',
        'versao-desconhecida.json',
        'id-mensagem-nao-uuid.json',
        'timestamp-sem-z.json',
        'telemetria-sem-medidas.json',
        'unidade-vazia.json',
        'latitude-fora-do-limite.json',
        'tipo-desconhecido.json',
      ]),
    );
  });

  it.each(invalid.map((example) => [example.file, example.data] as const))('%s', (file, data) => {
    const rule = expected[file];
    if (!rule) throw new Error(`Sem erro esperado para ${file}`);

    const result = validator.validate(rule.contrato, data);
    expect(result.valid).toBe(false);

    const match: Partial<ValidationIssue> = { path: rule.caminho, keyword: rule.regra };
    if (rule.campo_ausente) match.params = { missingProperty: rule.campo_ausente };
    if (rule.campo_extra) match.params = { additionalProperty: rule.campo_extra };
    expect(result.errors).toContainEqual(expect.objectContaining(match));
  });
});

describe('validador de schema', () => {
  it('rejeita entrada que não é objeto', () => {
    const result = validator.validate('mensagem', 'texto');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ path: '', keyword: 'type' }));
  });

  it('devolve mensagem legível em cada erro', () => {
    const result = validator.validate('mensagem', {});
    expect(result.errors.every((error) => error.message.length > 0)).toBe(true);
  });

  it('aceita polígono com anel fechado e recusa anel com menos de 4 posições', () => {
    const base = listExamples('valid').find((e) => e.file === 'evento-porta-aberta.json')!;
    const data = structuredClone(base.data) as { local: { geo: { coordinates: unknown } } };
    data.local.geo.coordinates = [
      [
        [-49.27, -16.68],
        [-49.26, -16.68],
        [-49.27, -16.68],
      ],
    ];
    const result = validator.validate('mensagem', data);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: '/local/geo/coordinates/0', keyword: 'minItems' }),
    );
  });
});
