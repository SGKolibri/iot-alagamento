import { HeaderActorContext } from './header-actor-context';

describe('ActorContext de desenvolvimento (cabeçalho X-Ator)', () => {
  it('o autor vem do cabeçalho, sem espaços nas pontas', () => {
    const context = new HeaderActorContext({});
    expect(context.resolve({ headers: { 'x-ator': ' operador-1 ' } })).toBe('operador-1');
  });

  it('sem cabeçalho, repetido, em branco ou longo demais, não há autor', () => {
    const context = new HeaderActorContext({});
    expect(context.resolve({ headers: {} })).toBeNull();
    expect(context.resolve({ headers: { 'x-ator': ['a', 'b'] } })).toBeNull();
    expect(context.resolve({ headers: { 'x-ator': '   ' } })).toBeNull();
    expect(context.resolve({ headers: { 'x-ator': 'x'.repeat(201) } })).toBeNull();
  });

  it('recusa existir em produção', () => {
    expect(() => new HeaderActorContext({ NODE_ENV: 'production' })).toThrow(
      'O ActorContext por cabeçalho X-Ator é só para desenvolvimento',
    );
  });
});
