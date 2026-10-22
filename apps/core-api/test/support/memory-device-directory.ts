import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DeviceDirectoryPort, DeviceRecord, Location, Principal } from '@iot/domain';

// Formato do arquivo de cadastro em memória (config/dev/device-directory.json).
// As credenciais não ficam no arquivo: cada item aponta a variável de ambiente que a contém.
interface FixtureFile {
  inquilinos: {
    id: string;
    slug: string;
    dispositivos: {
      id: string;
      slug: string;
      site: string;
      dominio: string;
      credencial_env?: string;
      local?: Location;
      atributos?: Record<string, number>;
      perfil: {
        intervalo_esperado_s: number;
        grandezas: {
          nome: string;
          unidade: string;
          faixa?: { min?: number; max?: number };
          expressao?: string;
        }[];
      };
    }[];
    nos_borda?: { id: string; credencial_env?: string }[];
  }[];
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Adaptador em memória do DeviceDirectoryPort, só para testes de unidade (a T1b trocou pelo catálogo).
export class MemoryDeviceDirectory implements DeviceDirectoryPort {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly principals = new Map<string, Principal>();

  static fromFile(path: string, env: NodeJS.ProcessEnv = process.env): MemoryDeviceDirectory {
    return new MemoryDeviceDirectory(JSON.parse(readFileSync(path, 'utf8')) as FixtureFile, env);
  }

  constructor(fixture: FixtureFile, env: NodeJS.ProcessEnv) {
    const credential = (name: string | undefined) => (name ? env[name] : undefined);
    for (const tenant of fixture.inquilinos) {
      for (const d of tenant.dispositivos) {
        this.devices.set(`${tenant.slug}/${d.slug}`, {
          id: d.id,
          slug: d.slug,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          site: d.site,
          domain: d.dominio,
          location: d.local,
          attributes: d.atributos ?? {},
          profile: {
            expectedIntervalSeconds: d.perfil.intervalo_esperado_s,
            quantities: d.perfil.grandezas.map((g) => ({
              name: g.nome,
              unit: g.unidade,
              ...(g.faixa ? { range: g.faixa } : {}),
              ...(g.expressao ? { expression: g.expressao } : {}),
            })),
          },
        });
        const token = credential(d.credencial_env);
        if (token) {
          this.principals.set(hash(token), {
            kind: 'device',
            tenantSlug: tenant.slug,
            deviceSlug: d.slug,
          });
        }
      }
      for (const node of tenant.nos_borda ?? []) {
        const token = credential(node.credencial_env);
        if (token) {
          this.principals.set(hash(token), {
            kind: 'edge',
            tenantSlug: tenant.slug,
            nodeId: node.id,
          });
        }
      }
    }
  }

  async findDevice(tenantSlug: string, deviceSlug: string): Promise<DeviceRecord | null> {
    return this.devices.get(`${tenantSlug}/${deviceSlug}`) ?? null;
  }

  async authenticate(credential: string): Promise<Principal | null> {
    if (!credential) return null;
    return this.principals.get(hash(credential)) ?? null;
  }
}
