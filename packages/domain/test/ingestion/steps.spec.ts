import {
  AuthenticateStep,
  DeadLetterStep,
  DeduplicateStep,
  EnrichStep,
  LATE_AFTER_INTERVALS,
  OrderStep,
  PublishStep,
  ValidateStep,
  type PipelineContext,
  type PipelineItem,
} from '../../src';
import {
  FakeSchemaValidator,
  FixedClock,
  MemoryDeadLetters,
  MemoryDeduplication,
  MemoryDirectory,
  MemoryEventBus,
  MemoryLogger,
  MemoryMeasurements,
  NOW,
  TOPIC,
  telemetry,
  waterLevelDevice,
} from './support';

const context: PipelineContext = { source: 'mqtt', topic: TOPIC, receivedAt: NOW };

function item(raw: Record<string, unknown>, extra: Partial<PipelineItem> = {}): PipelineItem {
  return {
    index: 0,
    raw,
    status: 'pending',
    issues: [],
    logger: new MemoryLogger(),
    late: false,
    measurements: [],
    ...extra,
  };
}

function ready(raw: Record<string, unknown>): PipelineItem {
  return item(raw, {
    message: raw as never,
    device: waterLevelDevice(),
    timestamp: new Date(raw.timestamp as string),
  });
}

describe('cada etapa roda sozinha', () => {
  it('Autenticar carrega o cadastro do dispositivo do tópico', async () => {
    const [out] = await new AuthenticateStep(new MemoryDirectory()).run(
      [item(telemetry())],
      context,
    );
    expect(out?.device?.slug).toBe('nivel-01');
  });

  it('Validar recusa o que o validador recusa e guarda a mensagem do que aceita', async () => {
    const ok = item(telemetry(), { device: waterLevelDevice() });
    const bad = item(telemetry({ versao: '9' }), { device: waterLevelDevice() });
    await new ValidateStep(new FakeSchemaValidator()).run([ok, bad]);
    expect(ok.message?.id_mensagem).toBe(ok.raw && (ok.raw as { id_mensagem: string }).id_mensagem);
    expect(ok.timestamp).toEqual(new Date('2026-10-25T11:59:00Z'));
    expect(bad.status).toBe('refused');
  });

  it('Deduplicar só consulta o registro de ids vistos', async () => {
    const dedup = new MemoryDeduplication();
    const first = ready(telemetry());
    await dedup.remember(waterLevelDevice().tenantId, [
      (first.raw as { id_mensagem: string }).id_mensagem,
    ]);
    await new DeduplicateStep(dedup).run([first]);
    expect(first.status).toBe('duplicate');
  });

  it('Ordenar devolve os itens pelo horário e marca atraso', async () => {
    const recent = ready(telemetry({ timestamp: '2026-10-25T11:59:00Z' }));
    const old = ready(telemetry({ timestamp: '2026-10-25T11:00:00Z' }));
    const out = await new OrderStep(new FixedClock()).run([recent, old]);
    expect(out).toEqual([old, recent]);
    expect(old.late).toBe(true);
    expect(LATE_AFTER_INTERVALS).toBe(3);
  });

  it('Enriquecer produz as medições normalizadas e a derivada', async () => {
    const it = ready(telemetry());
    await new EnrichStep().run([it], context);
    expect(it.measurements.map((m) => m.quantity)).toEqual([
      'distancia_agua',
      'bateria',
      'nivel_agua',
    ]);
  });

  it('Publicar grava, publica e registra o id como visto', async () => {
    const repo = new MemoryMeasurements();
    const bus = new MemoryEventBus();
    const dedup = new MemoryDeduplication();
    const it = ready(telemetry());
    await new EnrichStep().run([it], context);
    await new PublishStep(repo, bus, dedup).run([it], context);
    expect(it.status).toBe('accepted');
    expect(repo.rows).toHaveLength(3);
    expect(bus.events).toHaveLength(1);
    expect(dedup.seen.size).toBe(1);
  });

  it('Publicar sem itens pendentes não toca nas portas', async () => {
    const repo = new MemoryMeasurements();
    const refused = ready(telemetry());
    refused.status = 'refused';
    await new PublishStep(repo, new MemoryEventBus(), new MemoryDeduplication()).run(
      [refused],
      context,
    );
    expect(repo.calls).toEqual([]);
  });

  it('DLQ guarda só os recusados, com o tópico', async () => {
    const dlq = new MemoryDeadLetters();
    const refused = item(telemetry(), {
      status: 'refused',
      issues: [{ path: '', rule: 'x', message: 'y' }],
    });
    await new DeadLetterStep(dlq).run([refused, ready(telemetry())], context);
    expect(dlq.letters).toEqual([
      expect.objectContaining({ topic: 'inquilino-a/site-a/dominio-a/nivel-01/telemetria' }),
    ]);
  });
});
