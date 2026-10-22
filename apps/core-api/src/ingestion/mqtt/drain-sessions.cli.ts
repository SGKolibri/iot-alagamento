// pnpm mqtt:drain-sessions --de 8 --ate 31: drena e apaga as sessões <MQTT_INGEST_CLIENT_ID>-N
// de N = de até ate (inclusive), por exemplo depois de reduzir MQTT_INGEST_CONNECTIONS de 32
// para 8 (ADR-017). As mensagens passam pelo mesmo pipeline da ingestão.
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { findRepoRoot, loadIngestionConfig } from '../infra/config';
import { MqttIngestionSubscriber } from './mqtt-ingestion.subscriber';
import { drainSessions } from './session-drainer';
import { sharedSubscriptions } from './topic';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { de: { type: 'string' }, ate: { type: 'string' } } });
  const root = findRepoRoot();
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const settings = loadIngestionConfig().mqtt;
  if (!settings) throw new Error('MQTT_HOST não definido');
  const from = Number(values.de);
  const to = Number(values.ate ?? values.de);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new Error('use --de N --ate M, com 0 <= N <= M');
  }
  // O app sobe sem o assinante MQTT e sem tarefas de fundo; só o pipeline é usado.
  delete process.env.MQTT_HOST;
  delete process.env.REDIS_HOST;
  process.env.LOG_LEVEL ??= 'warn';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const subscriber = app.get(MqttIngestionSubscriber);
    const clientIds = Array.from(
      { length: to - from + 1 },
      (_, i) => `${settings.clientId}-${from + i}`,
    );
    const results = await drainSessions({
      url: settings.url,
      username: settings.username,
      password: settings.password,
      clientIds,
      topics: sharedSubscriptions(settings.shareGroup),
      handle: (topic, payload) => subscriber.handle(topic, payload),
    });
    for (const r of results)
      console.log(`${r.clientId}: ${r.drained} mensagens drenadas, sessão apagada`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
