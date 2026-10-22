import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LoggingBridgeModule } from './logging-bridge.module';
import { DeviceStatusConsumer, DeviceStatusSweeper } from './device-status';
import { DevicesController } from './devices.controller';

// RF-DIS-01, 02 e 06: dispositivos, credenciais e estado.
@Module({
  imports: [CatalogModule, LoggingBridgeModule],
  controllers: [DevicesController],
  providers: [DeviceStatusConsumer, DeviceStatusSweeper],
})
export class DevicesModule {}
