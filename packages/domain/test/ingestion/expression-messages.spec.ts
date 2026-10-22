import { compileExpression, ExpressionError } from '../../src';

// A T1b mostra estas mensagens ao validar o perfil; cada erro diz o que está errado.
describe('mensagens de erro do avaliador de expressões', () => {
  it.each([
    ['', 'expressão vazia'],
    ['a +', 'expressão incompleta'],
    ['a b', 'símbolo inesperado: b'],
    [')', 'símbolo inesperado: )'],
    ['(a', 'esperado ")"'],
    ['a.b', 'acesso a membro não permitido em "a"'],
    ['atributos.constructor', 'nome proibido: constructor'],
    ['a & b', 'caractere não permitido: &'],
    ['sqrt(1)', 'função não permitida: sqrt'],
    ['min()', 'número de argumentos inválido em min'],
    ['abs(1, 2)', 'número de argumentos inválido em abs'],
  ])('%j → %s', (source, message) => {
    let error: unknown;
    try {
      compileExpression(source);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ExpressionError);
    expect((error as ExpressionError).name).toBe('ExpressionError');
    expect((error as ExpressionError).message).toBe(message);
  });
});
