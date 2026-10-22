import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

// Config da CLI do Prisma (geração do cliente e do SQL do catálogo). O app não lê este
// arquivo: em execução, o cliente usa o adaptador pg com as variáveis POSTGRES_*.
const envFile = join(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;
const url =
  env.DATABASE_URL ??
  `postgresql://${env.POSTGRES_USER ?? 'iot'}:${encodeURIComponent(env.POSTGRES_PASSWORD ?? '')}@${env.POSTGRES_HOST ?? 'localhost'}:${env.POSTGRES_PORT ?? '5432'}/${env.POSTGRES_DB ?? 'iot'}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url },
});
