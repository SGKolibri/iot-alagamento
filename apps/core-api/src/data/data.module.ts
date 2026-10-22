import { Module } from '@nestjs/common';
import { LoggingBridgeModule } from '../devices/logging-bridge.module';
import { LastValuesConsumer } from './last-values.consumer';
import { LastValuesController } from './last-values.controller';
import { SeriesController } from './series.controller';

// Camada de dados (G2): último valor (RF-DAD-02) e série (RF-DAD-01).
@Module({
  imports: [LoggingBridgeModule],
  controllers: [LastValuesController, SeriesController],
  providers: [LastValuesConsumer],
})
export class DataModule {}
