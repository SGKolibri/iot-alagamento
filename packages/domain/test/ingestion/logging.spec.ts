import { TOPIC, nextId, setup, telemetry } from './support';

// RF-OBS-02: cada registro diz a etapa, e os registros da mensagem carregam o id_mensagem.
describe('registros de log do pipeline', () => {
  it('mensagem recebida registra dispositivo e quem autenticou', async () => {
    const { pipeline, logger } = setup();
    const body = telemetry();
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });
    await pipeline.ingestMessage({
      source: 'http',
      credential: 'token-nivel-01',
      body: telemetry(),
    });

    const received = logger.records.filter((r) => r.message === 'mensagem recebida');
    expect(received.map((r) => [r.level, r.fields, r.bindings.origem])).toEqual([
      ['debug', { dispositivo: 'nivel-01', principal: 'broker' }, 'mqtt'],
      ['debug', { dispositivo: 'nivel-01', principal: 'device' }, 'http'],
    ]);
  });

  it('recusa registra a etapa e os erros', async () => {
    const { pipeline, logger, validator } = setup();
    validator.messageRule = () => [{ path: '/x', rule: 'r', message: 'm' }];
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    expect(logger.records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'mensagem recusada',
        fields: { etapa: 'validar', erros: [{ path: '/x', rule: 'r', message: 'm' }] },
      }),
    );
  });

  it.each([
    ['autenticar', { topic: { ...TOPIC, device: 'outro' } }, telemetry({ dispositivo: 'outro' })],
    [
      'enriquecer',
      { topic: TOPIC },
      telemetry({ medidas: [{ grandeza: 'x', valor: 1, unidade: 'cm' }] }),
    ],
  ])('recusa na etapa %s fica registrada com o nome da etapa', async (step, request, body) => {
    const { pipeline, logger } = setup();
    await pipeline.ingestMessage({ source: 'mqtt', topic: request.topic, body });
    const refused = logger.records.find((r) => r.message === 'mensagem recusada');
    expect(refused?.fields.etapa).toBe(step);
  });

  it('duplicata, atraso e aceite registram a etapa e os detalhes', async () => {
    const { pipeline, logger } = setup();
    const old = telemetry({ timestamp: '2026-10-25T11:00:00Z' });
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: old });
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: old });

    const of = (message: string) =>
      logger.records.filter((r) => r.message === message).map((r) => [r.level, r.fields]);
    expect(of('mensagem atrasada')).toEqual([['info', { etapa: 'ordenar' }]]);
    expect(of('mensagem aceita')).toEqual([
      ['info', { etapa: 'publicar', medidas: 3, atrasada: true }],
    ]);
    expect(of('mensagem duplicada descartada')).toEqual([['info', { etapa: 'deduplicar' }]]);
  });

  it('expressão inválida registra a etapa, a grandeza e o erro', async () => {
    const { pipeline, directory, logger } = setup();
    directory.devices[0]!.profile.quantities[1]!.expression = 'sqrt(1)';
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    expect(logger.records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        fields: { etapa: 'enriquecer', grandeza: 'nivel_agua', erro: 'função não permitida: sqrt' },
      }),
    );
  });

  it('credencial inválida registra a origem, na mensagem e no lote', async () => {
    const { pipeline, logger } = setup();
    await pipeline.ingestMessage({ source: 'http', credential: 'x', body: telemetry() });
    await pipeline.ingestBatch({ credential: 'x', body: {} });
    expect(logger.records.map((r) => [r.level, r.fields, r.message])).toEqual([
      ['warn', { origem: 'http' }, 'mensagem sem credencial válida'],
      ['warn', { origem: 'batch' }, 'lote sem credencial válida'],
    ]);
  });

  it('lote recusado inteiro registra o id_lote e os erros', async () => {
    const { pipeline, logger, validator } = setup();
    const issue = { path: '/mensagens', rule: 'maxItems', message: 'demais' };
    validator.batchRule = () => [issue];
    const idLote = nextId();
    await pipeline.ingestBatch({ credential: 'token-borda', body: { id_lote: idLote } });
    expect(logger.records).toContainEqual({
      level: 'warn',
      bindings: {},
      fields: { origem: 'batch', id_lote: idLote, erros: [issue] },
      message: 'lote recusado inteiro',
    });
  });
});
