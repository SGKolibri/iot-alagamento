import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { SystemClock } from '../ingestion/adapters/system-clock';
import { loadIngestionConfig, type IngestionConfig } from '../ingestion/infra/config';
import { APP_CONFIG, CLOCK, PG_POOL, PRISMA, REDIS } from './tokens';

// Conexões compartilhadas pelo catálogo, pelos dispositivos e pela ingestão. O Prisma usa o
// mesmo pg.Pool das consultas cruas (ADR-015).
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadIngestionConfig() },
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: IngestionConfig) => new Pool({ ...config.postgres, max: 10 }),
    },
    {
      provide: PRISMA,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PrismaClient({ adapter: new PrismaPg(pool) }),
    },
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      // lazyConnect: o app sobe mesmo sem Redis; a conexão abre no primeiro comando.
      useFactory: (config: IngestionConfig) =>
        new Redis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 3 }),
    },
  ],
  exports: [APP_CONFIG, CLOCK, PG_POOL, PRISMA, REDIS],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pool.end();
    this.redis.disconnect();
  }
}
