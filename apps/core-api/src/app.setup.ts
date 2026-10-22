import type { NestExpressApplication } from '@nestjs/platform-express';
import { bodyParserErrorHandler, ErrorFilter } from './http/error.filter';
import { PinoNestLogger } from './logging/pino-nest-logger';

// Configuração comum ao main.ts e aos testes: logs JSON pelo pino, prefixo /api/v1 (o /health fica fora) e
// limite do corpo JSON que comporta um lote de 5.000 mensagens.
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.useLogger(app.get(PinoNestLogger));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  const limit = process.env.HTTP_BODY_LIMIT ?? '10mb';
  app.useBodyParser('json', { limit });
  app.use(bodyParserErrorHandler(limit));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
