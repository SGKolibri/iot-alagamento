import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { LoggingModule } from './logging/logging.module';

@Module({ imports: [LoggingModule, IngestionModule], controllers: [HealthController] })
export class AppModule {}
