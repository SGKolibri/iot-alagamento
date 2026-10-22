import type { Device } from '../generated/prisma/client';

export const DEVICE_SORTABLE = {
  slug: 'slug',
  estado: 'status',
  ultimo_contato_em: 'lastContactAt',
  criado_em: 'createdAt',
};

const iso = (date: Date | null) => (date ? date.toISOString() : null);

// Esquema Dispositivo do openapi.yaml. Os campos da credencial nunca saem daqui, só as datas.
export function toDispositivo(d: Device, location: unknown) {
  return {
    id: d.id,
    slug: d.slug,
    perfil_id: d.profileId,
    perfil_versao: d.profileVersion,
    dominio_id: d.domainId,
    site_id: d.siteId,
    area_id: d.areaId,
    fabricante: d.manufacturer,
    firmware: d.firmware,
    atributos: d.attributes as Record<string, number>,
    tags: d.tags,
    localizacao: location ?? null,
    estado: d.status,
    ultimo_contato_em: iso(d.lastContactAt),
    credencial_expira_em: iso(d.credentialExpiresAt),
    credencial_revogada_em: iso(d.credentialRevokedAt),
  };
}
