// Sobe o AppModule pelo tsx (esbuild, sem metadados de decorator) e confere que nenhuma
// dependência dos controllers ficou undefined. Usado por test/tsx-injection.spec.ts.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { AreasController } from '../../src/catalog/areas.controller';
import { DomainsController } from '../../src/catalog/domains.controller';
import { ProfilesController } from '../../src/catalog/profiles.controller';
import { SitesController } from '../../src/catalog/sites.controller';
import { DevicesController } from '../../src/devices/devices.controller';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const missing: string[] = [];
  for (const type of [
    DomainsController,
    ProfilesController,
    SitesController,
    AreasController,
    DevicesController,
  ]) {
    const instance = app.get(type) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(instance)) {
      if (value === undefined) missing.push(`${type.name}.${key}`);
    }
  }
  await app.close();
  console.log(JSON.stringify({ missing }));
}

void main();
