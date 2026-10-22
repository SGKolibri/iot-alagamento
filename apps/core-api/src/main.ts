import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { findRepoRoot } from './ingestion/infra/config';

async function bootstrap(): Promise<void> {
  const envFile = join(findRepoRoot(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  await app.listen(Number(process.env.CORE_API_PORT ?? 3001));
}

void bootstrap();
