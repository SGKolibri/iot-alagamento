import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PINO } from '../src/logging/logging.module';
import { memoryStream } from '../src/logging/memory-stream';

describe('logs JSON do app inteiro (RF-OBS-02)', () => {
  let app: NestExpressApplication;
  const { stream, records } = memoryStream();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PINO)
      .useValue(pino({ level: 'info' }, stream))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('os logs do próprio NestJS saem em JSON pelo pino, com o contexto', () => {
    expect(records).toContainEqual(
      expect.objectContaining({ contexto: 'RoutesResolver', level: 30 }),
    );
  });

  it('cada requisição HTTP gera um registro com o id_mensagem do corpo', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingestao')
      .send({ id_mensagem: 'm-correlacao-1' })
      .expect(401);
    const lines = records.filter((r) => r.id_mensagem === 'm-correlacao-1');
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: 'requisição HTTP',
        metodo: 'POST',
        rota: '/api/v1/ingestao',
        status: 401,
        duracao_ms: expect.any(Number),
      }),
    );
    // O pipeline escreve no mesmo destino.
    expect(records).toContainEqual(
      expect.objectContaining({ msg: 'mensagem sem credencial válida', servico: 'core-api' }),
    );
  });

  it('requisição sem id_mensagem não ganha o campo', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const line = records.find((r) => r.msg === 'requisição HTTP' && r.rota === '/health');
    expect(line).toBeDefined();
    expect(line).not.toHaveProperty('id_mensagem');
  });

  it('o lote registra o id_lote', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingestao/lote')
      .send({ id_lote: 'lote-correlacao-1', mensagens: [] })
      .expect(401);
    expect(records).toContainEqual(
      expect.objectContaining({ msg: 'requisição HTTP', id_lote: 'lote-correlacao-1' }),
    );
  });
});
