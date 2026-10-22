import { Global, Inject, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import pino, { type Logger } from 'pino';
import { PinoNestLogger } from './pino-nest-logger';

export const PINO = Symbol('PINO');

function correlation(body: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof body !== 'object' || body === null) return fields;
  const { id_mensagem: messageId, id_lote: batchId } = body as Record<string, unknown>;
  if (typeof messageId === 'string') fields.id_mensagem = messageId;
  if (typeof batchId === 'string') fields.id_lote = batchId;
  return fields;
}

// Um único pino para o app: logs do NestJS, das requisições HTTP e do pipeline de ingestão.
@Global()
@Module({
  providers: [
    {
      provide: PINO,
      useFactory: (): Logger =>
        pino({ level: process.env.LOG_LEVEL ?? 'info', base: { servico: 'core-api' } }),
    },
    {
      provide: PinoNestLogger,
      inject: [PINO],
      useFactory: (logger: Logger) => new PinoNestLogger(logger),
    },
  ],
  exports: [PINO, PinoNestLogger],
})
export class LoggingModule implements NestModule {
  constructor(@Inject(PINO) private readonly logger: Logger) {}

  // Um registro por requisição, com id_mensagem ou id_lote do corpo quando existirem.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        const started = process.hrtime.bigint();
        res.on('finish', () => {
          this.logger.info(
            {
              metodo: req.method,
              rota: req.originalUrl,
              status: res.statusCode,
              duracao_ms: Number(process.hrtime.bigint() - started) / 1e6,
              ...correlation(req.body),
            },
            'requisição HTTP',
          );
        });
        next();
      })
      .forRoutes('*path');
  }
}
