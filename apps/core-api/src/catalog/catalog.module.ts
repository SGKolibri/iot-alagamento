import { Module } from '@nestjs/common';
import { AreasController } from './areas.controller';
import { CatalogEvents } from './catalog-events';
import { DomainsController } from './domains.controller';
import { ProfilesController } from './profiles.controller';
import { REQUEST_VALIDATOR, RequestValidator } from './request-validator';
import { SitesController } from './sites.controller';

// RF-CEN-01 a 04: domínios, perfis, sites e áreas por inquilino.
@Module({
  controllers: [DomainsController, ProfilesController, SitesController, AreasController],
  providers: [
    { provide: REQUEST_VALIDATOR, useFactory: () => RequestValidator.create() },
    CatalogEvents,
  ],
  exports: [REQUEST_VALIDATOR, CatalogEvents],
})
export class CatalogModule {}
