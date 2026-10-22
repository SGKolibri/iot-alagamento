import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorFilter, jsonParseErrorHandler } from './http/error.filter';

// Configuração comum ao main.ts e aos testes: prefixo /api/v1 (o /health fica fora) e
// limite do corpo JSON que comporta um lote de 5.000 mensagens.
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useBodyParser('json', { limit: process.env.HTTP_BODY_LIMIT ?? '10mb' });
  app.use(jsonParseErrorHandler);
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
