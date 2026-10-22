import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({ imports: [IngestionModule], controllers: [HealthController] })
export class AppModule {}
