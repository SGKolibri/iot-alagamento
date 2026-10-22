import { validateProfileQuantities, type QuantitySpec } from '../../src';

const ok: QuantitySpec[] = [
  { name: 'distancia', unit: 'cm', range: { min: 0, max: 400 } },
  { name: 'nivel', unit: 'cm', expression: 'atributos.altura - distancia' },
  { name: 'bateria', unit: 'mV' },
];

describe('validação das grandezas do perfil (RF-CEN-02)', () => {
  it('aceita um perfil válido, inclusive faixa com mínimo igual ao máximo', () => {
    expect(validateProfileQuantities(ok)).toEqual([]);
    expect(
      validateProfileQuantities([{ name: 'x', unit: '%', range: { min: 5, max: 5 } }]),
    ).toEqual([]);
  });

  it('recusa faixa invertida', () => {
    expect(
      validateProfileQuantities([{ name: 'x', unit: 'cm', range: { min: 10, max: 1 } }]),
    ).toEqual([
      {
        path: '/grandezas/0/faixa',
        rule: 'faixa',
        message: 'o mínimo (10) é maior que o máximo (1)',
      },
    ]);
  });

  it('recusa unidade vazia ou com espaço', () => {
    expect(validateProfileQuantities([{ name: 'x', unit: '' }])).toEqual([
      {
        path: '/grandezas/0/unidade',
        rule: 'unidade',
        message: 'a unidade UCUM não pode ser vazia',
      },
    ]);
    expect(validateProfileQuantities([{ name: 'x', unit: 'm s' }])[0]?.rule).toBe('unidade');
  });

  it.each(['process.exit()', 'constructor', 'eval(1)', 'atributos.__proto__'])(
    'recusa a expressão perigosa %s',
    (expression) => {
      const issues = validateProfileQuantities([
        { name: 'a', unit: 'cm' },
        { name: 'x', unit: 'cm', expression },
      ]);
      expect(issues).toEqual([
        expect.objectContaining({ path: '/grandezas/1/expressao', rule: 'expressao' }),
      ]);
    },
  );

  it('recusa expressão que cita grandeza inexistente ou a si mesma', () => {
    expect(validateProfileQuantities([{ name: 'x', unit: 'cm', expression: 'y + 1' }])).toEqual([
      {
        path: '/grandezas/0/expressao',
        rule: 'expressao',
        message: 'a expressão cita a grandeza y, que não existe no perfil',
      },
    ]);
    expect(validateProfileQuantities([{ name: 'x', unit: 'cm', expression: 'x + 1' }])[0]).toEqual(
      expect.objectContaining({ message: 'a expressão cita a própria grandeza x' }),
    );
  });

  it('recusa nomes de grandeza repetidos', () => {
    expect(
      validateProfileQuantities([
        { name: 'x', unit: 'cm' },
        { name: 'x', unit: 'm' },
      ]),
    ).toEqual([{ path: '/grandezas/1/nome', rule: 'unico', message: 'grandeza repetida: x' }]);
  });

  it('recusa perfil sem grandezas', () => {
    expect(validateProfileQuantities([])).toEqual([
      {
        path: '/grandezas',
        rule: 'minItems',
        message: 'o perfil precisa de ao menos uma grandeza',
      },
    ]);
  });

  it('as mensagens dizem o campo e o motivo', () => {
    expect(validateProfileQuantities([{ name: 'x', unit: 'm s' }])).toEqual([
      {
        path: '/grandezas/0/unidade',
        rule: 'unidade',
        message: 'a unidade UCUM não pode ter espaço: m s',
      },
    ]);
    expect(validateProfileQuantities([{ name: 'x', unit: 'cm', expression: 'sqrt(1)' }])).toEqual([
      {
        path: '/grandezas/0/expressao',
        rule: 'expressao',
        message: 'expressão inválida: função não permitida: sqrt',
      },
    ]);
    expect(validateProfileQuantities([{ name: 'x', unit: 'cm', expression: 'x + 1' }])).toEqual([
      {
        path: '/grandezas/0/expressao',
        rule: 'expressao',
        message: 'a expressão cita a própria grandeza x',
      },
    ]);
  });
});
