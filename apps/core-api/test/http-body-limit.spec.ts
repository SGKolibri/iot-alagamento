import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('limite do corpo HTTP', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.HTTP_BODY_LIMIT = '1kb';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.HTTP_BODY_LIMIT;
    await app.close();
  });

  it('corpo acima do limite devolve 413 no esquema Erro', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/ingestao/lote')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ texto: 'x'.repeat(4096) }))
      .expect(413);
    expect(response.body).toEqual({
      codigo: 'corpo_grande_demais',
      mensagem: 'o corpo passa do limite de 1kb',
    });
  });
});
