// Smoke test da infraestrutura central (RNF-14).
// Sobe o compose e verifica, em ordem: healthchecks, extensões do PostgreSQL,
// publicação e assinatura MQTT e o realm iot do Keycloak.
// Uso: pnpm test:infra (requer .env, copiado de .env.example)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import mqtt from 'mqtt';
import pg from 'pg';

const EXPECTED_SERVICES = ['postgres', 'redis', 'mosquitto', 'keycloak', 'mailpit'];
const EXPECTED_ROLES = ['administrador', 'gestor', 'operador', 'integrador', 'leitor'];
const EXPECTED_CLIENTS = ['panel', 'core-api'];

type Step = { name: string; run: () => Promise<string | void> };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: 'pipe' });
}

async function composeUpAndHealthy(): Promise<string> {
  try {
    compose('up', '-d', '--wait', '--wait-timeout', '300');
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    throw new Error(`docker compose up falhou:\n${stderr}`, { cause: error });
  }
  const lines = compose('ps', '--all', '--format', 'json').trim().split('\n').filter(Boolean);
  const services = lines.map((line) => JSON.parse(line) as { Service: string; Health: string });
  const health = new Map(services.map((s) => [s.Service, s.Health]));
  const unhealthy = EXPECTED_SERVICES.filter((name) => health.get(name) !== 'healthy');
  if (unhealthy.length > 0) {
    const detail = unhealthy.map((n) => `${n}=${health.get(n) ?? 'ausente'}`).join(', ');
    throw new Error(`Serviços sem healthcheck verde: ${detail}`);
  }
  return EXPECTED_SERVICES.join(', ');
}

async function postgresExtensions(): Promise<string> {
  const client = new pg.Client({
    host: 'localhost',
    port: Number(env('POSTGRES_PORT')),
    user: env('POSTGRES_USER'),
    password: env('POSTGRES_PASSWORD'),
    database: env('POSTGRES_DB'),
  });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    const { rows } = await client.query<{ extname: string; extversion: string }>(
      "SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb', 'postgis') ORDER BY extname",
    );
    if (rows.length !== 2) throw new Error(`Extensões encontradas: ${JSON.stringify(rows)}`);
    // Prova de uso real, além da instalação: uma hipertabela e uma geometria.
    await client.query('BEGIN');
    await client.query('CREATE TABLE infra_smoke (ts timestamptz NOT NULL, v double precision)');
    await client.query("SELECT create_hypertable('infra_smoke', 'ts')");
    await client.query(
      'SELECT ST_AsText(ST_GeomFromGeoJSON(\'{"type":"Point","coordinates":[-48.95,-16.32]}\'))',
    );
    await client.query('ROLLBACK');
    return rows.map((r) => `${r.extname} ${r.extversion}`).join(', ');
  } finally {
    await client.end();
  }
}

function connectMqtt(options: mqtt.IClientOptions): Promise<mqtt.MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtt://localhost:${env('MQTT_PORT')}`, {
      reconnectPeriod: 0,
      connectTimeout: 5000,
      ...options,
    });
    client.once('connect', () => resolve(client));
    client.once('error', (error) => {
      client.end(true);
      reject(error);
    });
  });
}

async function mqttRoundTrip(): Promise<string> {
  // Sem credencial, o broker precisa recusar.
  const anonymous = await connectMqtt({}).then(
    (client) => {
      client.end(true);
      return 'aceita';
    },
    () => 'recusada',
  );
  if (anonymous !== 'recusada') throw new Error('Conexão MQTT anônima foi aceita');

  const client = await connectMqtt({
    username: env('MQTT_DEV_USERNAME'),
    password: env('MQTT_DEV_PASSWORD'),
  });
  try {
    const topic = `infra-smoke/${randomUUID()}`;
    const payload = randomUUID();
    await client.subscribeAsync(topic, { qos: 1 });
    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mensagem MQTT não chegou em 5 s')), 5000);
      client.on('message', (t, message) => {
        if (t === topic) {
          clearTimeout(timer);
          resolve(message.toString());
        }
      });
    });
    await client.publishAsync(topic, payload, { qos: 1 });
    if ((await received) !== payload) throw new Error('Payload MQTT diferente do publicado');
    return 'anônimo recusado; publicação QoS 1 recebida pela assinatura';
  } finally {
    await client.endAsync();
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url} respondeu ${response.status}`);
  return (await response.json()) as T;
}

async function keycloakRealm(): Promise<string> {
  const base = `http://localhost:${env('KEYCLOAK_PORT')}`;
  const discovery = await getJson<{ issuer: string }>(
    `${base}/realms/iot/.well-known/openid-configuration`,
  );
  if (!discovery.issuer.endsWith('/realms/iot')) {
    throw new Error(`Issuer inesperado: ${discovery.issuer}`);
  }

  // A descoberta OpenID não lista papéis; eles são conferidos pela API de administração.
  const token = await getJson<{ access_token: string }>(
    `${base}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env('KEYCLOAK_ADMIN_USERNAME'),
        password: env('KEYCLOAK_ADMIN_PASSWORD'),
      }),
    },
  );
  const auth = { headers: { Authorization: `Bearer ${token.access_token}` } };
  const roles = await getJson<{ name: string }[]>(`${base}/admin/realms/iot/roles`, auth);
  const roleNames = roles.map((r) => r.name);
  const missingRoles = EXPECTED_ROLES.filter((r) => !roleNames.includes(r));
  if (missingRoles.length > 0) throw new Error(`Papéis ausentes: ${missingRoles.join(', ')}`);

  const clients = await getJson<{ clientId: string }[]>(`${base}/admin/realms/iot/clients`, auth);
  const clientIds = clients.map((c) => c.clientId);
  const missingClients = EXPECTED_CLIENTS.filter((c) => !clientIds.includes(c));
  if (missingClients.length > 0) throw new Error(`Clients ausentes: ${missingClients.join(', ')}`);

  return `issuer ${discovery.issuer}; papéis ${EXPECTED_ROLES.join(', ')}; clients ${EXPECTED_CLIENTS.join(', ')}`;
}

const steps: Step[] = [
  { name: 'compose sobe com healthchecks verdes', run: composeUpAndHealthy },
  { name: 'CREATE EXTENSION timescaledb e postgis', run: postgresExtensions },
  { name: 'publicação MQTT chega à assinatura', run: mqttRoundTrip },
  { name: 'descoberta OpenID do realm iot e os cinco papéis', run: keycloakRealm },
];

async function main(): Promise<void> {
  if (!existsSync('.env')) {
    throw new Error('Arquivo .env não encontrado. Rode: cp .env.example .env');
  }
  process.loadEnvFile('.env');

  for (const [index, step] of steps.entries()) {
    const label = `[${index + 1}/${steps.length}] ${step.name}`;
    try {
      const detail = await step.run();
      console.log(`✔ ${label}${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      console.error(`✘ ${label}\n  ${(error as Error).message}`);
      process.exit(1);
    }
  }
  console.log('Infraestrutura OK');
}

main().catch((error: unknown) => {
  console.error(`✘ ${(error as Error).message}`);
  process.exit(1);
});
