import { compileExpression, convertUnit } from '../../src';
import { MemoryDirectory, TOPIC, nextId, setup, telemetry } from './support';

const batch = (mensagens: unknown[]) => ({
  versao: '1.0',
  id_lote: nextId(),
  origem: 'b',
  mensagens,
});

describe('regras de borda do pipeline', () => {
  it.each([
    ['/mensagens/12/versao', 'índice com dois dígitos'],
    ['/mensagens/3', 'a própria mensagem'],
  ])('erro em %s (%s) recusa só a mensagem, não o lote', async (path) => {
    const { pipeline, validator } = setup();
    validator.batchRule = () => [{ path, rule: 'x', message: 'y' }];
    const outcome = await pipeline.ingestBatch({
      credential: 'token-nivel-01',
      body: batch([telemetry()]),
    });
    expect(outcome.status).toBe('processed');
  });

  it('erro fora do início do caminho recusa o lote inteiro', async () => {
    const { pipeline, validator } = setup();
    validator.batchRule = () => [{ path: '/extra/mensagens/0', rule: 'x', message: 'y' }];
    const outcome = await pipeline.ingestBatch({
      credential: 'token-nivel-01',
      body: batch([telemetry()]),
    });
    expect(outcome.status).toBe('rejected');
  });

  it('corpo sem dispositivo nem tipo cai na validação, sem erro de tópico ou credencial', async () => {
    const { pipeline } = setup();
    const body = telemetry();
    delete body.dispositivo;
    delete body.tipo;
    const mqtt = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body });
    const http = await pipeline.ingestMessage({
      source: 'http',
      credential: 'token-nivel-01',
      body: { ...body },
    });
    expect(mqtt.issues.map((i) => i.rule)).not.toContain('topico');
    expect(http.issues.map((i) => i.rule)).not.toContain('credencial');
  });

  it('corpo nulo é recusado sem derrubar o pipeline', async () => {
    const { pipeline } = setup();
    const outcome = await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: null });
    expect(outcome.status).toBe('refused');
  });

  it('o cadastro é consultado uma vez por dispositivo em cada lote', async () => {
    const { pipeline, directory } = setup();
    const calls: string[] = [];
    const original = directory.findDevice.bind(directory);
    directory.findDevice = async (tenant, device) => {
      calls.push(device);
      return original(tenant, device);
    };
    await pipeline.ingestBatch({
      credential: 'token-borda',
      body: batch([telemetry(), telemetry(), telemetry()]),
    });
    expect(calls).toEqual(['nivel-01']);
    expect(directory).toBeInstanceOf(MemoryDirectory);
  });

  it('sem recusas a DLQ não é chamada, e sem medições o repositório também não', async () => {
    const { pipeline, deadLetters, measurements } = setup();
    let dlqCalls = 0;
    deadLetters.saveAll = async () => {
      dlqCalls += 1;
    };
    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'evento' },
      body: {
        versao: '1.0',
        id_mensagem: nextId(),
        dispositivo: 'nivel-01',
        tipo: 'evento',
        timestamp: '2026-10-25T11:59:00Z',
        evento: { codigo: 'x' },
      },
    });
    expect(dlqCalls).toBe(0);
    expect(measurements.calls).toEqual([]);
  });

  it('telemetria com campo evento publica só o evento de medição', async () => {
    const { pipeline, eventBus } = setup();
    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: TOPIC,
      body: telemetry({ evento: { codigo: 'x' }, estado: { a: 1 } }),
    });
    expect(eventBus.events.map((e) => e.type)).toEqual(['measurement.ingested']);
  });

  it('os limites da faixa válida não são suspeitos; um passo além é', async () => {
    const { pipeline, measurements } = setup();
    const at = (valor: number, second: number) =>
      telemetry({
        timestamp: `2026-10-25T11:59:0${second}Z`,
        medidas: [{ grandeza: 'distancia_agua', valor, unidade: 'cm' }],
      });
    for (const [second, valor] of [0, 400, -0.1, 400.1].entries()) {
      await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: at(valor, second) });
    }
    expect(
      measurements.rows.filter((m) => m.quantity === 'distancia_agua').map((m) => m.suspect),
    ).toEqual([false, false, true, true]);
  });

  it('derivada pode usar outra derivada calculada antes', async () => {
    const { pipeline, directory, measurements } = setup();
    directory.devices[0]!.profile.quantities.push({
      name: 'nivel_metros',
      unit: 'm',
      expression: 'nivel_agua / 100',
    });
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    expect(measurements.rows.find((m) => m.quantity === 'nivel_metros')?.value).toBe(1.8);
  });

  it('derivada só de atributos não aparece em mensagem sem medidas', async () => {
    const { pipeline, directory, measurements } = setup();
    directory.devices[0]!.profile.quantities[1]!.expression = 'atributos.altura_instalacao_cm';
    await pipeline.ingestMessage({
      source: 'mqtt',
      topic: { ...TOPIC, kind: 'estado' },
      body: {
        versao: '1.0',
        id_mensagem: nextId(),
        dispositivo: 'nivel-01',
        tipo: 'estado',
        timestamp: '2026-10-25T11:59:00Z',
        estado: { a: 1 },
      },
    });
    expect(measurements.rows).toEqual([]);
  });

  it('expressão inválida no perfil é compilada e registrada uma vez só', async () => {
    const { pipeline, directory, logger } = setup();
    directory.devices[0]!.profile.quantities[1]!.expression = 'sqrt(1)';
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    await pipeline.ingestMessage({ source: 'mqtt', topic: TOPIC, body: telemetry() });
    expect(logger.records.filter((r) => r.level === 'error')).toHaveLength(1);
  });
});

describe('regras de borda do avaliador e das unidades', () => {
  it('número com mais de uma casa decimal', () => {
    expect(compileExpression('a * 1.25').evaluate(new Map([['a', 4]]))).toBe(5);
  });

  it('função com referência ausente devolve null', () => {
    expect(compileExpression('min(a, 1)').evaluate(new Map())).toBeNull();
  });

  it('referências dentro de funções entram na lista', () => {
    expect(compileExpression('max(a, abs(b))').references).toEqual(['a', 'b']);
  });

  it.each(['prototype', 'atributos.prototype', '__proto__'])('rejeita o nome %s', (source) => {
    expect(() => compileExpression(source)).toThrow('nome proibido');
  });

  it('unidade fora da tabela passa quando é igual à do perfil', () => {
    expect(convertUnit(7, 'Pa', 'Pa')).toBe(7);
  });
});
