import type { ActionContext } from '@iot/domain';
import type { Pool } from 'pg';

const CACHE_MS = 60_000;

// Slug e tópico de cada dispositivo para o contexto das ações (comando canônico no tópico
// {inquilino}/{site}/{dominio}/{dispositivo}/comando).
export class DeviceAddresses {
  private readonly cache = new Map<string, { device: ActionContext['device']; until: number }>();

  constructor(private readonly pool: Pool) {}

  async get(tenantId: string, deviceId: string): Promise<ActionContext['device']> {
    const hit = this.cache.get(deviceId);
    if (hit && hit.until > Date.now()) return hit.device;
    const { rows } = await this.pool.query<{
      slug: string;
      tenant: string;
      site: string;
      domain: string;
    }>(
      `SELECT d.slug, t.slug AS tenant, s.slug AS site, dm.slug AS domain
         FROM devices d
         JOIN tenants t ON t.id = d.tenant_id
         JOIN sites s ON s.id = d.site_id AND s.tenant_id = d.tenant_id
         JOIN domains dm ON dm.id = d.domain_id AND dm.tenant_id = d.tenant_id
        WHERE d.id = $1 AND d.tenant_id = $2`,
      [deviceId, tenantId],
    );
    const row = rows[0];
    const device: ActionContext['device'] = row
      ? {
          id: deviceId,
          slug: row.slug,
          topic: { tenant: row.tenant, site: row.site, domain: row.domain, device: row.slug },
        }
      : { id: deviceId, slug: deviceId };
    this.cache.set(deviceId, { device, until: Date.now() + CACHE_MS });
    return device;
  }
}
