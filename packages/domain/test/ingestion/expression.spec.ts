import { ExpressionError, compileExpression } from '../../src';

const vars = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('avaliador de expressões das grandezas derivadas', () => {
  it('calcula aritmética com precedência, parênteses e sinal', () => {
    const expr = compileExpression('-(a + 2) * 3 / 2 - -1');
    expect(expr.evaluate(vars({ a: 4 }))).toBe(-8);
  });

  it('lê atributos.* e grandezas', () => {
    const expr = compileExpression('atributos.altura_instalacao_cm - distancia_agua');
    expect(
      expr.evaluate(vars({ 'atributos.altura_instalacao_cm': 300, distancia_agua: 120 })),
    ).toBe(180);
    expect(expr.references).toEqual(['atributos.altura_instalacao_cm', 'distancia_agua']);
  });

  it('aceita min, max e abs', () => {
    const expr = compileExpression('max(0, min(abs(a), 10.5))');
    expect(expr.evaluate(vars({ a: -20 }))).toBe(10.5);
    expect(expr.evaluate(vars({ a: -2 }))).toBe(2);
  });

  it('devolve null quando falta uma referência', () => {
    expect(compileExpression('a + b').evaluate(vars({ a: 1 }))).toBeNull();
  });

  it('devolve null quando o resultado não é finito', () => {
    expect(compileExpression('a / 0').evaluate(vars({ a: 1 }))).toBeNull();
  });

  it.each([
    ['process.exit()', 'process.exit()'],
    ['constructor', 'constructor'],
    ['constructor.constructor("return process")()', 'constructor encadeado'],
    ['atributos.__proto__', '__proto__'],
    ['atributos.constructor', 'atributos.constructor'],
    ['eval(1)', 'eval'],
    ['Function("x")', 'Function'],
    ['sqrt(4)', 'função fora da lista'],
    ['a; b', 'separador'],
    ['a["b"]', 'colchetes'],
    ['"texto"', 'string'],
    ['a +', 'expressão incompleta'],
    ['(a', 'parêntese aberto'],
    ['a)', 'parêntese sobrando'],
    ['min()', 'função sem argumento'],
    ['abs(1, 2)', 'abs com dois argumentos'],
    ['1..2', 'número malformado'],
    ['', 'vazia'],
    ['a.b', 'acesso a membro fora de atributos'],
  ])('9. rejeita %s (%s)', (source) => {
    expect(() => compileExpression(source)).toThrow(ExpressionError);
  });
});
