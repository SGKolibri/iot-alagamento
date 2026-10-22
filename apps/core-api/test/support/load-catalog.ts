import request from 'supertest';
import { createTenant, type TestApp } from './app';
import type { LoadTarget } from './mqtt-load';

// Inquilino, domínio, perfil, site e um dispositivo para os testes de carga MQTT.
export async function createLoadCatalog(t: TestApp, tenant: string): Promise<LoadTarget> {
  await createTenant(t.db, tenant);
  const api = async (path: string, body: object) =>
    (
      await request(t.app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('X-Tenant', tenant)
        .send(body)
        .expect(201)
    ).body;
  const dominio = await api('/catalogo/dominios', { slug: 'carga', nome: 'Carga' });
  const perfil = await api('/perfis', {
    dominio_id: dominio.id,
    nome: 'termômetro',
    intervalo_esperado_s: 60,
    grandezas: [{ nome: 'temperatura', unidade: 'Cel' }],
  });
  const site = await api('/sites', { slug: 'laboratorio', nome: 'Laboratório' });
  await api('/dispositivos', { slug: 'sensor-carga', perfil_id: perfil.id, site_id: site.id });
  return {
    url: `mqtt://${t.infra.env.MQTT_HOST}:${t.infra.env.MQTT_PORT}`,
    username: t.infra.env.MQTT_INGEST_USERNAME!,
    password: t.infra.env.MQTT_INGEST_PASSWORD!,
    topic: `${tenant}/laboratorio/carga/sensor-carga/telemetria`,
    device: 'sensor-carga',
  };
}

export function report(label: string, data: unknown): void {
  process.stdout.write(`\n[contabilidade] ${label}: ${JSON.stringify(data)}\n`);
}
