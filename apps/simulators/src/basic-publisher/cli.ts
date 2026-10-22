// basic-publisher: publica N mensagens canônicas por MQTT, HTTP ou lote.
// Uso: pnpm --filter @iot/simulators basic-publisher -- --modo mqtt --n 10 [opções]
// Credenciais vêm do .env da raiz (MQTT_DEV_USERNAME, MQTT_DEV_PASSWORD, SIM_DEVICE_TOKEN).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import mqtt from 'mqtt';
import { buildBatch, buildMessages, topicFor, type PublisherOptions } from './messages';

function loadRootEnv(): void {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml')) && dirname(dir) !== dir) dir = dirname(dir);
  const file = join(dir, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values } = parseArgs({
  options: {
    modo: { type: 'string', default: 'mqtt' },
    n: { type: 'string', default: '10' },
    inquilino: { type: 'string', default: 'defesa-civil' },
    site: { type: 'string', default: 'bairro-centro' },
    dominio: { type: 'string', default: 'alagamento' },
    dispositivo: { type: 'string', default: 'nivel-corrego-01' },
    grandeza: { type: 'string', default: 'distancia_agua' },
    unidade: { type: 'string', default: 'cm' },
    'valor-inicial': { type: 'string', default: '200' },
    passo: { type: 'string', default: '-1' },
    intervalo: { type: 'string', default: '60', short: 'i' },
    'espera-ms': { type: 'string', default: '0' },
    inicio: { type: 'string' },
    invalidas: { type: 'string', default: '' },
    token: { type: 'string' },
    url: { type: 'string' },
    origem: { type: 'string' },
  },
});

async function main(): Promise<void> {
  loadRootEnv();
  const count = Number(values.n);
  const intervalMs = Number(values.intervalo) * 1000;
  const options: PublisherOptions = {
    tenant: values.inquilino!,
    site: values.site!,
    domain: values.dominio!,
    device: values.dispositivo!,
    quantity: values.grandeza!,
    unit: values.unidade!,
    initialValue: Number(values['valor-inicial']),
    step: Number(values.passo),
    count,
    intervalMs,
    // Por padrão a última medição sai com o horário atual.
    start: values.inicio
      ? new Date(values.inicio)
      : new Date(Date.now() - (count - 1) * intervalMs),
    invalidAt: values.invalidas ? values.invalidas.split(',').map(Number) : [],
  };
  const messages = buildMessages(options);
  const waitMs = Number(values['espera-ms']);
  const apiUrl = values.url ?? `http://localhost:${process.env.CORE_API_PORT ?? 3001}/api/v1`;
  const token = values.token ?? process.env.SIM_DEVICE_TOKEN ?? '';

  if (values.modo === 'mqtt') {
    const client = await mqtt.connectAsync(`mqtt://localhost:${process.env.MQTT_PORT ?? 1883}`, {
      username: process.env.MQTT_DEV_USERNAME,
      password: process.env.MQTT_DEV_PASSWORD,
    });
    const topic = topicFor(options);
    for (const message of messages) {
      await client.publishAsync(topic, JSON.stringify(message), { qos: 1 });
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    await client.endAsync();
    console.log(JSON.stringify({ modo: 'mqtt', topico: topic, publicadas: messages.length }));
    return;
  }

  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };

  if (values.modo === 'http') {
    const results = [];
    for (const message of messages) {
      results.push(await post('/ingestao', message));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    console.log(JSON.stringify({ modo: 'http', respostas: results }, null, 2));
    return;
  }

  if (values.modo === 'lote') {
    const result = await post(
      '/ingestao/lote',
      buildBatch(messages, values.origem ?? options.device),
    );
    console.log(JSON.stringify({ modo: 'lote', ...result }, null, 2));
    return;
  }
  throw new Error(`modo desconhecido: ${values.modo} (use mqtt, http ou lote)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
