import { Global, Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { PRISMA } from '../infra/tokens';
import { HeaderTenantContext } from './header-tenant-context';
import { TENANT_CONTEXT, type TenantRef } from './tenant-context';
import { TenantGuard } from './tenant.guard';

const CACHE_MS = 30_000;

@Global()
@Module({
  providers: [
    {
      provide: TENANT_CONTEXT,
      inject: [PRISMA],
      // Adaptador de desenvolvimento; recusa subir com NODE_ENV=production (T3 troca pela claim).
      useFactory: (prisma: PrismaClient) => {
        const cache = new Map<string, { tenant: TenantRef | null; until: number }>();
        return new HeaderTenantContext(async (slug) => {
          const hit = cache.get(slug);
          if (hit && hit.until > Date.now()) return hit.tenant;
          const found = await prisma.tenant.findUnique({
            where: { slug },
            select: { id: true, slug: true },
          });
          cache.set(slug, { tenant: found, until: Date.now() + CACHE_MS });
          return found;
        });
      },
    },
    TenantGuard,
  ],
  exports: [TENANT_CONTEXT, TenantGuard],
})
export class TenancyModule {}
