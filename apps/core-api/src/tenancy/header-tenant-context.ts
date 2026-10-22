import type { TenantContextPort, TenantRef, TenantRequest } from './tenant-context';

// Adaptador de desenvolvimento: o inquilino vem do cabeçalho X-Tenant (slug), sem prova de
// identidade. Por isso não pode existir com NODE_ENV=production.
export class HeaderTenantContext implements TenantContextPort {
  constructor(
    private readonly lookup: (slug: string) => Promise<TenantRef | null>,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'O TenantContext por cabeçalho X-Tenant é só para desenvolvimento; em produção o inquilino vem do token (T3).',
      );
    }
  }

  async resolve(request: TenantRequest): Promise<TenantRef | null> {
    const slug = request.headers['x-tenant'];
    if (typeof slug !== 'string' || slug.length === 0) return null;
    return this.lookup(slug);
  }
}
