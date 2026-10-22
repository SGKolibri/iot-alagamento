import { shouldReplaceLastValue } from '../../src';

const at = (iso: string) => new Date(iso);

describe('regra do último valor (RF-DAD-02)', () => {
  it('sem valor guardado, a medição entra', () => {
    expect(shouldReplaceLastValue(null, at('2026-10-22T12:00:00Z'))).toBe(true);
  });

  it('1. medição mais antiga que a guardada nunca sobrescreve', () => {
    expect(shouldReplaceLastValue(at('2026-10-22T12:00:00Z'), at('2026-10-22T11:59:59.999Z'))).toBe(
      false,
    );
  });

  it('2. a mesma medição repetida (evento repetido) não altera', () => {
    expect(shouldReplaceLastValue(at('2026-10-22T12:00:00Z'), at('2026-10-22T12:00:00Z'))).toBe(
      false,
    );
  });

  it('medição mais nova substitui', () => {
    expect(shouldReplaceLastValue(at('2026-10-22T12:00:00Z'), at('2026-10-22T12:00:00.001Z'))).toBe(
      true,
    );
  });
});
