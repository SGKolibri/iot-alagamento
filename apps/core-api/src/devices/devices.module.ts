import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DevicesController } from './devices.controller';
import { TelemetryController } from './telemetry.controller';

// RF-DIS-01, 02 e 06: dispositivos, credenciais e estado.
@Module({
  imports: [CatalogModule],
  controllers: [DevicesController, TelemetryController],
})
export class DevicesModule {}
