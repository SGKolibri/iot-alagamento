import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Device, PrismaClient } from '../generated/prisma/client';
import { CatalogEvents } from '../catalog/catalog-events';
import { geometriesOf, geometrySql } from '../catalog/geometry';
import {
  badRequest,
  listQuery,
  mapDatabaseError,
  notFound,
  page,
  requireUuid,
} from '../catalog/http-errors';
import { REQUEST_VALIDATOR, type RequestValidator } from '../catalog/request-validator';
import { PRISMA } from '../infra/tokens';
import { CurrentTenant, TenantGuard } from '../tenancy/tenant.guard';
import type { TenantRef } from '../tenancy/tenant-context';
import { issueCredential } from './credentials';
import { DEVICE_SORTABLE, toDispositivo } from './device-mapper';

interface NovoDispositivo {
  slug: string;
  perfil_id: string;
  site_id: string;
  area_id?: string;
  fabricante?: string;
  firmware?: string;
  atributos?: Record<string, number>;
  tags?: string[];
  localizacao?: unknown;
  credencial_expira_em?: string;
}

type AlteracaoDispositivo = Partial<
  Omit<NovoDispositivo, 'slug' | 'perfil_id' | 'site_id' | 'area_id'>
> & {
  area_id?: string | null;
};

const STATUSES = new Set(['NUNCA_CONECTADO', 'ONLINE', 'SEM_SINAL']);

// RF-DIS-01 e RF-DIS-02: cadastro de dispositivos com credencial própria e revogável.
@Controller('dispositivos')
@UseGuards(TenantGuard)
export class DevicesController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REQUEST_VALIDATOR) private readonly requests: RequestValidator,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantRef, @Body() body: unknown) {
    const input = this.requests.assert<NovoDispositivo>('NovoDispositivo', body);
    const [profile, site] = await Promise.all([
      this.prisma.deviceProfile.findFirst({ where: { id: input.perfil_id, tenantId: tenant.id } }),
      this.prisma.site.findFirst({ where: { id: input.site_id, tenantId: tenant.id } }),
    ]);
    const issues = [];
    if (!profile)
      issues.push({
        path: '/perfil_id',
        rule: 'referencia',
        message: 'perfil não encontrado no inquilino',
      });
    if (!site)
      issues.push({
        path: '/site_id',
        rule: 'referencia',
        message: 'site não encontrado no inquilino',
      });
    if (input.area_id !== undefined)
      issues.push(...(await this.checkArea(tenant, input.area_id, input.site_id)));
    if (issues.length > 0) throw badRequest(issues);

    const credential = await issueCredential();
    const id = randomUUID();
    await this.prisma
      .$transaction([
        this.prisma.device.create({
          data: {
            id,
            tenantId: tenant.id,
            slug: input.slug,
            domainId: profile!.domainId,
            profileId: profile!.id,
            profileVersion: profile!.version,
            siteId: site!.id,
            areaId: input.area_id ?? null,
            manufacturer: input.fabricante ?? null,
            firmware: input.firmware ?? null,
            attributes: input.atributos ?? {},
            tags: input.tags ?? [],
            credentialId: credential.id,
            credentialHash: credential.hash,
            credentialSalt: credential.salt,
            credentialExpiresAt: input.credencial_expira_em
              ? new Date(input.credencial_expira_em)
              : null,
          },
        }),
        this.prisma
          .$executeRaw`UPDATE devices SET location = ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.localizacao)}), 4326) WHERE id = ${id}::uuid`,
      ])
      .catch((error: unknown) => mapDatabaseError(error, 'dispositivo'));
    this.events.changed();
    // O token só existe nesta resposta (RF-DIS-02).
    return { ...(await this.get(tenant, id)), credencial: credential.token };
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantRef, @Query() query: Record<string, unknown>) {
    const q = listQuery(query, DEVICE_SORTABLE, 'slug');
    const status =
      typeof query.estado === 'string' && STATUSES.has(query.estado) ? query.estado : undefined;
    if (query.estado !== undefined && !status) {
      throw badRequest([
        {
          path: 'estado',
          rule: 'consulta',
          message: `estado desconhecido: ${String(query.estado)}`,
        },
      ]);
    }
    const where = {
      tenantId: tenant.id,
      ...(status ? { status: status as Device['status'] } : {}),
      ...(typeof query.tag === 'string' ? { tags: { has: query.tag } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        orderBy: { [q.sort.field]: q.sort.direction },
        skip: q.offset,
        take: q.limit,
      }),
      this.prisma.device.count({ where }),
    ]);
    const locations = await geometriesOf(
      this.prisma,
      'devices',
      items.map((d) => d.id),
    );
    return page(
      items.map((d) => toDispositivo(d, locations.get(d.id))),
      total,
      q,
    );
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    const device = await this.find(tenant, id);
    return toDispositivo(
      device,
      (await geometriesOf(this.prisma, 'devices', [device.id])).get(device.id),
    );
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantRef, @Param('id') id: string, @Body() body: unknown) {
    const input = this.requests.assert<AlteracaoDispositivo>('AlteracaoDispositivo', body);
    const device = await this.find(tenant, id);
    if (input.area_id) {
      const issues = await this.checkArea(tenant, input.area_id, device.siteId);
      if (issues.length > 0) throw badRequest(issues);
    }
    await this.prisma.device.update({
      where: { id },
      data: {
        ...(input.area_id !== undefined ? { areaId: input.area_id } : {}),
        ...(input.fabricante !== undefined ? { manufacturer: input.fabricante } : {}),
        ...(input.firmware !== undefined ? { firmware: input.firmware } : {}),
        ...(input.atributos !== undefined ? { attributes: input.atributos } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
    });
    if (input.localizacao !== undefined) {
      await this.prisma
        .$executeRaw`UPDATE devices SET location = ST_SetSRID(ST_GeomFromGeoJSON(${geometrySql(input.localizacao)}), 4326) WHERE id = ${id}::uuid`.catch(
        (error: unknown) => mapDatabaseError(error, 'dispositivo'),
      );
    }
    this.events.changed();
    return this.get(tenant, id);
  }

  @Post(':id/credenciais/revogar')
  @HttpCode(200)
  async revoke(@CurrentTenant() tenant: TenantRef, @Param('id') id: string) {
    const device = await this.find(tenant, id);
    if (!device.credentialRevokedAt) {
      await this.prisma.device.update({ where: { id }, data: { credentialRevokedAt: new Date() } });
    }
    this.events.changed();
    return this.get(tenant, id);
  }

  private async checkArea(tenant: TenantRef, areaId: string, siteId: string) {
    const area = await this.prisma.area.findFirst({ where: { id: areaId, tenantId: tenant.id } });
    if (!area)
      return [
        { path: '/area_id', rule: 'referencia', message: 'área não encontrada no inquilino' },
      ];
    if (area.siteId !== siteId)
      return [{ path: '/area_id', rule: 'referencia', message: 'a área é de outro site' }];
    return [];
  }

  private async find(tenant: TenantRef, id: string): Promise<Device> {
    const found = await this.prisma.device.findFirst({
      where: { id: requireUuid(id, 'dispositivo'), tenantId: tenant.id },
    });
    if (!found) throw notFound('dispositivo');
    return found;
  }
}
