import { createHash } from 'node:crypto';
import type { ClockPort, DeviceDirectoryPort, DeviceRecord, Principal } from '@iot/domain';
import { geometriesOf } from '../../catalog/geometry';
import { toQuantitySpec, type Grandeza } from '../../catalog/quantities';
import { parseToken, verifySecret } from '../../devices/credentials';
import type { PrismaClient } from '../../generated/prisma/client';

interface CachedCredential {
  principal: Principal;
  expiresAt: Date | null;
  until: number;
}

// DeviceDirectoryPort sobre o catálogo (T1b). Cache curto em memória, limpo quando o catálogo
// muda neste processo (invalidate); em réplicas, o TTL limita a defasagem.
export class PrismaDeviceDirectory implements DeviceDirectoryPort {
  private readonly devices = new Map<string, { record: DeviceRecord | null; until: number }>();
  private readonly credentials = new Map<string, CachedCredential>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: ClockPort,
    private readonly ttlMs = 30_000,
  ) {}

  invalidate(): void {
    this.devices.clear();
    this.credentials.clear();
  }

  async findDevice(tenantSlug: string, deviceSlug: string): Promise<DeviceRecord | null> {
    const key = `${tenantSlug}/${deviceSlug}`;
    const now = this.clock.now().getTime();
    const hit = this.devices.get(key);
    if (hit && hit.until > now) return hit.record;
    const record = await this.load(tenantSlug, deviceSlug);
    this.devices.set(key, { record, until: now + this.ttlMs });
    return record;
  }

  // Credencial revogada, expirada, desconhecida ou com segredo errado: null (401 no HTTP e no lote).
  async authenticate(credential: string): Promise<Principal | null> {
    const parsed = parseToken(credential);
    if (!parsed) return null;
    const now = this.clock.now();
    // A chave do cache é um hash do token inteiro e só existe na memória do processo.
    const key = createHash('sha256').update(credential).digest('base64url');
    const hit = this.credentials.get(key);
    if (hit && hit.until > now.getTime()) {
      return hit.expiresAt && hit.expiresAt <= now ? null : hit.principal;
    }
    const device = await this.prisma.device.findUnique({
      where: { credentialId: parsed.id },
      include: { tenant: { select: { slug: true } } },
    });
    if (!device || device.credentialRevokedAt) return null;
    if (!(await verifySecret(parsed.secret, device.credentialSalt, device.credentialHash)))
      return null;
    if (device.credentialExpiresAt && device.credentialExpiresAt <= now) return null;
    const principal: Principal = {
      kind: 'device',
      tenantSlug: device.tenant.slug,
      deviceSlug: device.slug,
    };
    this.credentials.set(key, {
      principal,
      expiresAt: device.credentialExpiresAt,
      until: now.getTime() + this.ttlMs,
    });
    return principal;
  }

  private async load(tenantSlug: string, deviceSlug: string): Promise<DeviceRecord | null> {
    const device = await this.prisma.device.findFirst({
      where: { slug: deviceSlug, tenant: { slug: tenantSlug } },
      include: { tenant: true, domain: true, site: true, area: true, profile: true },
    });
    if (!device) return null;
    const geo = (await geometriesOf(this.prisma, 'devices', [device.id])).get(device.id);
    return {
      id: device.id,
      slug: device.slug,
      tenantId: device.tenantId,
      tenantSlug: device.tenant.slug,
      site: device.site.slug,
      domain: device.domain.slug,
      location: {
        site: device.site.slug,
        ...(device.area ? { area: device.area.slug } : {}),
        ...(geo ? { geo } : {}),
      },
      attributes: device.attributes as Record<string, number>,
      profile: {
        expectedIntervalSeconds: device.profile.expectedIntervalS,
        quantities: (device.profile.quantities as unknown as Grandeza[]).map(toQuantitySpec),
      },
    };
  }
}
