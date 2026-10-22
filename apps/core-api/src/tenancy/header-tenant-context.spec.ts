import { HeaderTenantContext } from './header-tenant-context';

const tenants = { 'inquilino-a': { id: 'id-a', slug: 'inquilino-a' } };
const lookup = async (slug: string) => tenants[slug as keyof typeof tenants] ?? null;

describe('TenantContext de desenvolvimento (cabeçalho X-Tenant)', () => {
  it('resolve o inquilino pelo cabeçalho', async () => {
    const context = new HeaderTenantContext(lookup, {});
    expect(await context.resolve({ headers: { 'x-tenant': 'inquilino-a' } })).toEqual({
      id: 'id-a',
      slug: 'inquilino-a',
    });
  });

  it('sem cabeçalho, com cabeçalho repetido ou com inquilino desconhecido, não há contexto', async () => {
    const context = new HeaderTenantContext(lookup, {});
    expect(await context.resolve({ headers: {} })).toBeNull();
    expect(await context.resolve({ headers: { 'x-tenant': ['inquilino-a', 'b'] } })).toBeNull();
    expect(await context.resolve({ headers: { 'x-tenant': 'outro' } })).toBeNull();
  });

  it('recusa existir em produção', () => {
    expect(() => new HeaderTenantContext(lookup, { NODE_ENV: 'production' })).toThrow(
      'O TenantContext por cabeçalho X-Tenant é só para desenvolvimento',
    );
  });
});
