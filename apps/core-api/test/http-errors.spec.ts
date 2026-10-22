import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

// Erros HTTP sempre no esquema Erro do OpenAPI, sem depender de infraestrutura.
describe('erros HTTP no esquema Erro', () => {
  let app: NestExpressApplication;
  let contract: ResponseValidator;

  beforeAll(async () => {
    contract = await createResponseValidator();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('corpo JSON quebrado em POST /api/v1/ingestao devolve 400 no esquema Erro', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/ingestao')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(contract.validate('Erro', response.body).errors).toEqual([]);
    expect(response.body).toEqual({
      codigo: 'json_invalido',
      mensagem: 'o corpo não é um JSON válido',
    });
  });
});
