import { convertUnit } from '../../src';

describe('normalização de unidades (RF-PRO-01)', () => {
  it.each([
    [1.1, 'm', 'cm', 110],
    [15, 'mm', 'cm', 1.5],
    [0.3, 'mm', 'cm', 0.03],
    [1.8, 'mm', 'cm', 0.18],
    [132, 'cm', 'm', 1.32],
    [3.95, 'V', 'mV', 3950],
    [3980, 'mV', 'V', 3.98],
    [27.1, 'Cel', 'Cel', 27.1],
    [55, '%', '%', 55],
  ])('%s %s em %s dá %s, sem ruído de ponto flutuante', (value, from, to, expected) => {
    expect(convertUnit(value, from, to)).toBe(expected);
  });

  it.each([
    ['cm', 'mV'],
    ['K', 'Cel'],
    ['cm', 'pol'],
  ])('%s para %s não converte', (from, to) => {
    expect(convertUnit(1, from, to)).toBeNull();
  });
});
