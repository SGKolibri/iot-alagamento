import { NOW, TOPIC, setup, telemetry, waterLevelDevice } from './support';

describe('pipeline de ingestão', () => {
  it('1. mensagem válida vira uma medição por grandeza', async () => {
    const { pipeline, measurements, eventBus } = setup();
    const body = telemetry();

    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(outcome.status).toBe('accepted');
    const stored = measurements.rows.filter((m) => !m.derived);
    expect(stored.map((m) => [m.quantity, m.value, m.unit])).toEqual([
      ['distancia_agua', 120, 'cm'],
      ['bateria', 3900, 'mV'],
    ]);
    expect(stored[0]).toMatchObject({
      tenantId: waterLevelDevice().tenantId,
      deviceId: waterLevelDevice().id,
      messageId: body.id_mensagem,
      timestamp: new Date('2026-10-25T11:59:00Z'),
      receivedAt: NOW,
      suspect: false,
      late: false,
    });
    expect(eventBus.events).toHaveLength(1);
    expect(eventBus.events[0]).toMatchObject({
      type: 'measurement.ingested',
      messageId: body.id_mensagem,
      deviceSlug: 'nivel-01',
    });
  });

  it('2. mensagem fora do schema é recusada com motivo e vai para a DLQ', async () => {
    const { pipeline, measurements, deadLetters, eventBus } = setup();
    const body = telemetry({ versao: undefined });

    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(outcome.status).toBe('refused');
    expect(outcome.issues).toEqual([
      { path: '/versao', rule: 'required', message: 'campo obrigatório: versao' },
    ]);
    expect(measurements.rows).toEqual([]);
    expect(eventBus.events).toEqual([]);
    expect(deadLetters.letters).toEqual([
      expect.objectContaining({
        source: 'mqtt',
        topic: 'inquilino-a/site-a/dominio-a/nivel-01/telemetria',
        tenantId: waterLevelDevice().tenantId,
        messageId: body.id_mensagem,
        payload: body,
        issues: outcome.issues,
        receivedAt: NOW,
      }),
    ]);
  });

  it('3. id_mensagem repetido é descartado sem erro e não grava de novo', async () => {
    const { pipeline, measurements, eventBus, deadLetters } = setup();
    const body = telemetry();

    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });
    const again = await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: { ...body, medidas: [{ grandeza: 'bateria', valor: 1, unidade: 'mV' }] },
    });

    expect(again.status).toBe('duplicate');
    expect(again.issues).toEqual([]);
    expect(measurements.calls).toHaveLength(1);
    expect(eventBus.events).toHaveLength(1);
    expect(deadLetters.letters).toEqual([]);
  });

  it('4. duas mensagens que chegam invertidas são gravadas pelo timestamp', async () => {
    const { pipeline, measurements, eventBus } = setup();
    const later = telemetry({ timestamp: '2026-10-25T11:59:30Z' });
    const earlier = telemetry({ timestamp: '2026-10-25T11:58:30Z' });

    const outcome = await pipeline.ingestBatch({
      credential: 'token-nivel-01',
      body: { versao: '1.0', id_lote: 'lote-1', origem: 'nivel-01', mensagens: [later, earlier] },
    });

    expect(outcome.status).toBe('processed');
    const times = measurements.calls[0]!.map((m) => m.timestamp.toISOString());
    expect(times).toEqual([...times].sort());
    expect(times[0]).toBe('2026-10-25T11:58:30.000Z');
    expect(eventBus.events.map((e) => e.messageId)).toEqual([
      earlier.id_mensagem,
      later.id_mensagem,
    ]);
    // O resultado segue a ordem de chegada, para o cliente casar cada posição.
    if (outcome.status === 'processed') {
      expect(outcome.results.map((r) => r.messageId)).toEqual([
        later.id_mensagem,
        earlier.id_mensagem,
      ]);
    }
  });

  it('5. timestamp mais antigo que 3 intervalos esperados sai marcado late', async () => {
    const { pipeline, measurements, eventBus } = setup();
    // Intervalo esperado de 60 s: 3 intervalos = 180 s antes de NOW.
    const onTheEdge = telemetry({ timestamp: '2026-10-25T11:57:00Z' });
    const tooOld = telemetry({ timestamp: '2026-10-25T11:56:59.999Z' });

    const a = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: onTheEdge });
    const b = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: tooOld });

    expect(a.late).toBe(false);
    expect(b.late).toBe(true);
    expect(
      measurements.rows.filter((m) => m.messageId === tooOld.id_mensagem).every((m) => m.late),
    ).toBe(true);
    expect(eventBus.events.map((e) => e.late)).toEqual([false, true]);
  });

  it('6. unidade diferente da canônica é normalizada', async () => {
    const { pipeline, measurements } = setup();
    const body = telemetry({
      medidas: [
        { grandeza: 'distancia_agua', valor: 1.32, unidade: 'm' },
        { grandeza: 'bateria', valor: 3.95, unidade: 'V' },
      ],
    });

    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(measurements.rows.map((m) => [m.quantity, m.value, m.unit])).toEqual(
      expect.arrayContaining([
        ['distancia_agua', 132, 'cm'],
        ['bateria', 3950, 'mV'],
      ]),
    );
  });

  it('7. valor fora da faixa válida fica suspect e é gravado', async () => {
    const { pipeline, measurements } = setup();
    const body = telemetry({
      medidas: [
        { grandeza: 'distancia_agua', valor: 450, unidade: 'cm' },
        { grandeza: 'bateria', valor: 3900, unidade: 'mV' },
      ],
    });

    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(outcome.status).toBe('accepted');
    const distance = measurements.rows.find((m) => m.quantity === 'distancia_agua');
    expect(distance).toMatchObject({ value: 450, suspect: true });
    expect(measurements.rows.find((m) => m.quantity === 'bateria')?.suspect).toBe(false);
  });

  it('8. a grandeza derivada nivel_agua sai do atributo e de distancia_agua', async () => {
    const { pipeline, measurements } = setup();

    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });

    expect(measurements.rows.find((m) => m.quantity === 'nivel_agua')).toMatchObject({
      value: 180,
      unit: 'cm',
      derived: true,
      suspect: false,
    });
  });

  it('17. mensagem sem local é enriquecida com o local cadastrado do dispositivo', async () => {
    const { pipeline, eventBus } = setup();
    const body = telemetry();
    delete body.local;

    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(outcome.location).toEqual(waterLevelDevice().location);
    expect(eventBus.events[0]?.location).toEqual(waterLevelDevice().location);
  });

  it('17b. local parcial na mensagem completa o que falta com o cadastro', async () => {
    const { pipeline } = setup();
    const body = telemetry({ local: { area: 'outra-area' } });

    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });

    expect(outcome.location).toEqual({ ...waterLevelDevice().location, area: 'outra-area' });
  });
});
