import { TOPIC, nextId, setup, telemetry, waterLevelDevice } from './support';

const batch = (mensagens: unknown[]) => ({
  versao: '1.0',
  id_lote: nextId(),
  origem: 'borda-01',
  mensagens,
});

describe('autenticação e coerência (etapa Autenticar)', () => {
  it('HTTP sem credencial ou com credencial desconhecida devolve unauthorized e não grava', async () => {
    const { pipeline, measurements, deadLetters } = setup();
    const none = await pipeline.ingestMessage({ source: 'http', body: telemetry() });
    const wrong = await pipeline.ingestMessage({
      source: 'http',
      credential: 'x',
      body: telemetry(),
    });
    expect(none.status).toBe('unauthorized');
    expect(wrong.status).toBe('unauthorized');
    expect(measurements.rows).toEqual([]);
    expect(deadLetters.letters).toEqual([]);
  });

  it('HTTP com credencial do próprio dispositivo é aceito', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'http',
      credential: 'token-nivel-01',
      body: telemetry(),
    });
    expect(outcome.status).toBe('accepted');
  });

  it('HTTP com credencial de um dispositivo e corpo de outro é recusado', async () => {
    const { pipeline, deadLetters } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'http',
      credential: 'token-nivel-01',
      body: telemetry({ dispositivo: 'outro' }),
    });
    expect(outcome.status).toBe('refused');
    expect(outcome.issues[0]).toMatchObject({ path: '/dispositivo', rule: 'credencial' });
    expect(deadLetters.letters).toHaveLength(1);
  });

  it('MQTT com dispositivo do corpo diferente do tópico é recusado', async () => {
    const { pipeline, measurements } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ dispositivo: 'outro' }),
    });
    expect(outcome.status).toBe('refused');
    expect(outcome.issues).toEqual([
      expect.objectContaining({ path: '/dispositivo', rule: 'topico' }),
    ]);
    expect(measurements.rows).toEqual([]);
  });

  it('MQTT com tipo do corpo diferente do tópico é recusado', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'estado' },
      body: telemetry(),
    });
    expect(outcome.issues).toEqual([expect.objectContaining({ path: '/tipo', rule: 'topico' })]);
  });

  it('MQTT de dispositivo não cadastrado é recusado', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, device: 'fantasma' },
      body: telemetry({ dispositivo: 'fantasma' }),
    });
    expect(outcome.issues).toEqual([
      expect.objectContaining({ path: '/dispositivo', rule: 'cadastro' }),
    ]);
  });

  it('MQTT em site ou domínio diferente do cadastro é recusado', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, site: 'outro-site' },
      body: telemetry(),
    });
    expect(outcome.issues).toEqual([expect.objectContaining({ rule: 'topico' })]);
  });

  it('corpo que não é objeto é recusado pela validação', async () => {
    const { pipeline, deadLetters } = setup();
    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: 'lixo' });
    expect(outcome.status).toBe('refused');
    expect(deadLetters.letters[0]).toMatchObject({ payload: 'lixo', messageId: undefined });
  });
});

describe('lotes', () => {
  it('lote sem credencial válida devolve unauthorized', async () => {
    const { pipeline } = setup();
    expect(await pipeline.ingestBatch({ body: batch([telemetry()]) })).toEqual({
      status: 'unauthorized',
    });
  });

  it('erro fora de /mensagens/N recusa o lote inteiro sem gravar', async () => {
    const { pipeline, validator, measurements, deadLetters } = setup();
    validator.batchRule = () => [
      { path: '/mensagens', rule: 'maxItems', message: 'no máximo 5000 itens' },
      { path: '/mensagens/0/versao', rule: 'const', message: 'versão inválida' },
    ];
    const outcome = await pipeline.ingestBatch({
      credential: 'token-borda',
      body: batch([telemetry()]),
    });
    expect(outcome).toEqual({
      status: 'rejected',
      issues: [{ path: '/mensagens', rule: 'maxItems', message: 'no máximo 5000 itens' }],
    });
    expect(measurements.rows).toEqual([]);
    expect(deadLetters.letters).toEqual([]);
  });

  it('erros dentro de /mensagens/N recusam só aquela mensagem', async () => {
    const { pipeline, validator, measurements } = setup();
    validator.batchRule = () => [
      { path: '/mensagens/1/versao', rule: 'required', message: 'campo obrigatório: versao' },
    ];
    const outcome = await pipeline.ingestBatch({
      credential: 'token-borda',
      body: batch([telemetry(), telemetry({ versao: undefined }), telemetry()]),
    });
    expect(outcome.status).toBe('processed');
    if (outcome.status !== 'processed') return;
    expect(outcome.results.map((r) => r.status)).toEqual(['accepted', 'refused', 'accepted']);
    expect(measurements.calls).toHaveLength(1);
  });

  it('nó de borda envia mensagens de dispositivos do seu inquilino', async () => {
    const { pipeline, directory } = setup();
    directory.devices.push(waterLevelDevice({ id: 'id-b', slug: 'nivel-02' }));
    const outcome = await pipeline.ingestBatch({
      credential: 'token-borda',
      body: batch([
        telemetry(),
        telemetry({ dispositivo: 'nivel-02' }),
        telemetry({ dispositivo: 'x' }),
      ]),
    });
    if (outcome.status !== 'processed') throw new Error(outcome.status);
    expect(outcome.batchId).toMatch(/^0000/);
    expect(outcome.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'refused']);
  });

  it('lote de borda com mensagem sem dispositivo é recusado na validação', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestBatch({
      credential: 'token-borda',
      body: batch([{ versao: '1.0', id_mensagem: nextId() }]),
    });
    if (outcome.status !== 'processed') throw new Error(outcome.status);
    expect(outcome.results[0]?.issues).toEqual([
      expect.objectContaining({ rule: 'cadastro', message: 'dispositivo não identificado' }),
    ]);
  });

  it('id_mensagem repetido dentro do mesmo lote grava uma vez só', async () => {
    const { pipeline, measurements } = setup();
    const body = telemetry();
    const outcome = await pipeline.ingestBatch({
      credential: 'token-nivel-01',
      body: batch([body, { ...body }]),
    });
    if (outcome.status !== 'processed') throw new Error(outcome.status);
    expect(outcome.results.map((r) => r.status)).toEqual(['accepted', 'duplicate']);
    expect(measurements.rows.filter((m) => m.quantity === 'bateria')).toHaveLength(1);
  });
});

describe('validação e enriquecimento', () => {
  it('comando não entra pela ingestão', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'comando' },
      body: telemetry({ tipo: 'comando', comando: { nome: 'x' } }),
    });
    expect(outcome.issues).toEqual([expect.objectContaining({ path: '/tipo', rule: 'sentido' })]);
  });

  it('grandeza fora do perfil recusa a mensagem com o caminho da medida', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ medidas: [{ grandeza: 'pressao', valor: 1, unidade: 'Pa' }] }),
    });
    expect(outcome.issues).toEqual([
      expect.objectContaining({ path: '/medidas/0/grandeza', rule: 'perfil' }),
    ]);
  });

  it('a mensagem não pode enviar uma grandeza derivada pronta', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ medidas: [{ grandeza: 'nivel_agua', valor: 1, unidade: 'cm' }] }),
    });
    expect(outcome.issues[0]).toMatchObject({ path: '/medidas/0/grandeza', rule: 'perfil' });
  });

  it('unidade incompatível recusa a mensagem com o caminho da unidade', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ medidas: [{ grandeza: 'bateria', valor: 1, unidade: 'cm' }] }),
    });
    expect(outcome.issues).toEqual([
      expect.objectContaining({ path: '/medidas/0/unidade', rule: 'unidade' }),
    ]);
  });

  it('derivada sem a grandeza de origem fica de fora', async () => {
    const { pipeline, measurements } = setup();
    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ medidas: [{ grandeza: 'bateria', valor: 3900, unidade: 'mV' }] }),
    });
    expect(measurements.rows.map((m) => m.quantity)).toEqual(['bateria']);
  });

  it('derivada fora da faixa fica suspect', async () => {
    const { pipeline, directory, measurements } = setup();
    const device = directory.devices[0]!;
    device.profile.quantities[1]!.range = { min: 0, max: 100 };
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    expect(measurements.rows.find((m) => m.quantity === 'nivel_agua')?.suspect).toBe(true);
  });

  it('expressão inválida no perfil não derruba a mensagem e vai para o log', async () => {
    const { pipeline, directory, measurements, logger } = setup();
    directory.devices[0]!.profile.quantities[1]!.expression = 'process.exit()';
    const outcome = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry(),
    });
    expect(outcome.status).toBe('accepted');
    expect(measurements.rows.some((m) => m.quantity === 'nivel_agua')).toBe(false);
    expect(logger.records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'expressão de grandeza derivada inválida no perfil',
      }),
    );
  });

  it('evento e estado são aceitos e publicados no barramento, sem medições', async () => {
    const { pipeline, eventBus, measurements } = setup();
    const evento = {
      versao: '1.0',
      id_mensagem: nextId(),
      dispositivo: 'nivel-01',
      tipo: 'evento',
      timestamp: '2026-10-25T11:59:00Z',
      via: 'borda-01',
      evento: { codigo: 'tampa_aberta' },
    };
    const estado = { ...evento, id_mensagem: nextId(), tipo: 'estado', estado: { modo: 'ok' } };
    delete (estado as Record<string, unknown>).evento;

    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'evento' },
      body: evento,
    });
    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'estado' },
      body: estado,
    });

    expect(measurements.rows).toEqual([]);
    expect(eventBus.events).toEqual([
      expect.objectContaining({
        type: 'device.event.received',
        event: { codigo: 'tampa_aberta' },
        via: 'borda-01',
      }),
      expect.objectContaining({ type: 'device.state.reported', state: { modo: 'ok' } }),
    ]);
  });
});

describe('logs com identificador de correlação (RF-OBS-02)', () => {
  it('todo registro de uma mensagem carrega o seu id_mensagem', async () => {
    const { pipeline, logger } = setup();
    const ok = telemetry();
    const bad = telemetry({ dispositivo: 'outro' });

    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: ok });
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: bad });

    const forOk = logger.records.filter((r) => r.bindings.id_mensagem === ok.id_mensagem);
    const forBad = logger.records.filter((r) => r.bindings.id_mensagem === bad.id_mensagem);
    expect(forOk.map((r) => r.message)).toEqual(['mensagem recebida', 'mensagem aceita']);
    expect(forBad.map((r) => r.message)).toEqual(['mensagem recebida', 'mensagem recusada']);
    expect(logger.records.every((r) => 'id_mensagem' in r.bindings)).toBe(true);
  });
});
