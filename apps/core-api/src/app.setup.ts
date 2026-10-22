import type { NestExpressApplication } from '@nestjs/platform-express';
import { bodyParserErrorHandler, ErrorFilter } from './http/error.filter';

// Configuração comum ao main.ts e aos testes: prefixo /api/v1 (o /health fica fora) e
// limite do corpo JSON que comporta um lote de 5.000 mensagens.
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const limit = process.env.HTTP_BODY_LIMIT ?? '10mb';
  app.useBodyParser('json', { limit });
  app.use(bodyParserErrorHandler(limit));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
