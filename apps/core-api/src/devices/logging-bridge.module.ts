import { Module } from '@nestjs/common';
import type { LoggerPort } from '@iot/domain';
import type { Logger } from 'pino';
import { PinoLogger } from '../ingestion/adapters/pino-logger';
import { LOGGER } from '../ingestion/tokens';
import { PINO } from '../logging/logging.module';

// LoggerPort (pino) para os serviços de dispositivos, o mesmo formato da ingestão.
@Module({
  providers: [
    {
      provide: LOGGER,
      inject: [PINO],
      useFactory: (logger: Logger): LoggerPort => new PinoLogger(logger),
    },
  ],
  exports: [LOGGER],
})
export class LoggingBridgeModule {}
