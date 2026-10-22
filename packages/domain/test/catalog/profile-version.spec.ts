import { applyProfileChanges, type ProfileDefinition } from '../../src';

const profile: ProfileDefinition = {
  name: 'sensor de nível',
  version: 1,
  expectedIntervalS: 60,
  quantities: [
    { name: 'distancia', unit: 'cm', range: { min: 0, max: 400 } },
    { name: 'nivel', unit: 'cm', expression: 'atributos.altura - distancia' },
  ],
};

describe('versão do perfil (RF-CEN-02)', () => {
  it('alterar as grandezas incrementa a versão', () => {
    const changed = applyProfileChanges(profile, {
      quantities: [
        { ...profile.quantities[0]!, range: { min: 0, max: 500 } },
        profile.quantities[1]!,
      ],
    });
    expect(changed.version).toBe(2);
    expect(changed.quantities[0]!.range).toEqual({ min: 0, max: 500 });
  });

  it('acrescentar ou remover uma grandeza incrementa a versão', () => {
    expect(applyProfileChanges(profile, { quantities: [profile.quantities[0]!] }).version).toBe(2);
  });

  it('alterar só o nome ou o intervalo não incrementa', () => {
    const changed = applyProfileChanges(profile, { name: 'outro nome', expectedIntervalS: 30 });
    expect(changed).toEqual({ ...profile, name: 'outro nome', expectedIntervalS: 30 });
  });

  it('as mesmas grandezas em outra ordem, ou reenviadas iguais, não incrementam', () => {
    const reordered = [...profile.quantities].reverse().map((q) => ({ ...q }));
    expect(applyProfileChanges(profile, { quantities: reordered }).version).toBe(1);
  });

  it('não altera o perfil original', () => {
    applyProfileChanges(profile, { name: 'x', quantities: [] });
    expect(profile.name).toBe('sensor de nível');
    expect(profile.quantities).toHaveLength(2);
  });

  it.each([
    ['o mínimo da faixa', { ...profile.quantities[0]!, range: { min: 1, max: 400 } }, 0],
    [
      'a expressão da derivada',
      { ...profile.quantities[1]!, expression: 'atributos.altura - distancia * 2' },
      1,
    ],
    ['a unidade', { ...profile.quantities[0]!, unit: 'mm' }, 0],
  ] as const)('mudar só %s também sobe a versão', (_label, changed, index) => {
    const quantities = profile.quantities.map((q, i) => (i === index ? changed : q));
    expect(applyProfileChanges(profile, { quantities }).version).toBe(2);
  });

  it('mudar o mínimo de um valor não nulo para outro também sobe a versão', () => {
    const withMin = applyProfileChanges(profile, {
      quantities: [
        { ...profile.quantities[0]!, range: { min: 1, max: 400 } },
        profile.quantities[1]!,
      ],
    });
    const changed = applyProfileChanges(withMin, {
      quantities: [
        { ...profile.quantities[0]!, range: { min: 2, max: 400 } },
        profile.quantities[1]!,
      ],
    });
    expect(changed.version).toBe(withMin.version + 1);
  });
});
