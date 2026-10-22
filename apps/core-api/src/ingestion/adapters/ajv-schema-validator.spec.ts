import { AjvSchemaValidator } from './ajv-schema-validator';

const without = (field: string) =>
  Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));

const valid = {
  versao: '1.0',
  id_mensagem: '0b7f1c9e-3a52-4d0b-8f4e-5c1d2e7a9b10',
  dispositivo: 'sensor-a',
  tipo: 'telemetria',
  timestamp: '2026-10-20T21:10:00Z',
  medidas: [{ grandeza: 'temperatura', valor: 20, unidade: 'Cel' }],
};

describe('AjvSchemaValidator', () => {
  const validator = new AjvSchemaValidator();

  it('aceita a mensagem válida', () => {
    expect(validator.validateMessage(valid)).toEqual([]);
  });

  it('a versão declarada escolhe o schema; versão desconhecida vira erro em /versao', () => {
    expect(validator.validateMessage({ ...valid, versao: '2.0' })).toEqual([
      { path: '/versao', rule: 'versao', message: 'versão desconhecida: 2.0 (aceitas: 1.0)' },
    ]);
  });

  it('campo ausente aponta o caminho do campo', () => {
    expect(validator.validateMessage(without('versao'))).toEqual([
      { path: '/versao', rule: 'required', message: 'campo obrigatório ausente: versao' },
    ]);
  });

  it('campo fora do contrato aponta o campo', () => {
    expect(validator.validateMessage({ ...valid, nivel: 1 })).toEqual([
      { path: '/nivel', rule: 'additionalProperties', message: 'campo fora do contrato: nivel' },
    ]);
  });

  it.each([
    [
      { ...valid, tipo: 'alerta' },
      '/tipo',
      'enum',
      'valor fora da lista: telemetria, evento, estado, comando',
    ],
    [
      { ...valid, timestamp: '2026-10-20T18:10:00-03:00' },
      '/timestamp',
      'pattern',
      'formato inválido: o horário precisa estar em UTC, terminando em Z',
    ],
    [{ ...valid, medidas: [] }, '/medidas', 'minItems', 'precisa ter ao menos 1 item'],
    [
      { ...valid, medidas: [{ grandeza: 'x', valor: 1, unidade: '' }] },
      '/medidas/0/unidade',
      'minLength',
      'não pode ser vazio',
    ],
    [
      { ...valid, medidas: [{ grandeza: 'x', valor: '1', unidade: 'cm' }] },
      '/medidas/0/valor',
      'type',
      'precisa ser do tipo number',
    ],
    [
      { ...valid, local: { geo: { type: 'Point', coordinates: [0, 91] } } },
      '/local/geo/coordinates/1',
      'maximum',
      'precisa ser no máximo 90',
    ],
    [
      { ...valid, local: { geo: { type: 'Point', coordinates: [-181, 0] } } },
      '/local/geo/coordinates/0',
      'minimum',
      'precisa ser no mínimo -180',
    ],
    [{ ...valid, id_mensagem: 'x' }, '/id_mensagem', 'format', 'formato inválido: uuid'],
    [
      { ...valid, dispositivo: 'a b' },
      '/dispositivo',
      'pattern',
      'formato inválido: precisa seguir ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
    ],
  ])('traduz o erro para português (%#)', (data, path, rule, message) => {
    expect(validator.validateMessage(data)).toContainEqual({ path, rule, message });
  });

  it('não repete o erro genérico do if/then', () => {
    expect(validator.validateMessage(without('medidas')).map((i) => i.rule)).toEqual(['required']);
  });

  it('valida o lote e aponta o limite de mensagens', () => {
    const batch = {
      versao: '1.0',
      id_lote: '0b7f1c9e-3a52-4d0b-8f4e-5c1d2e7a9b10',
      origem: 'sensor-a',
      mensagens: Array.from({ length: 5001 }, () => valid),
    };
    expect(validator.validateBatch(batch)).toContainEqual({
      path: '/mensagens',
      rule: 'maxItems',
      message: 'pode ter no máximo 5000 itens',
    });
  });
});
