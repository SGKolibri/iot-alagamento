import { createSchemaValidator } from '@iot/contracts';
import { buildBatch, buildMessages, topicFor, type PublisherOptions } from './messages';

const options: PublisherOptions = {
  tenant: 'inquilino-a',
  site: 'site-a',
  domain: 'dominio-a',
  device: 'nivel-01',
  quantity: 'distancia_agua',
  unit: 'cm',
  initialValue: 100,
  step: 2.5,
  count: 4,
  intervalMs: 60_000,
  start: new Date('2026-10-25T12:00:00Z'),
};

describe('basic-publisher', () => {
  const validator = createSchemaValidator();

  it('gera N mensagens canônicas válidas, com valor e horário avançando pelo passo', () => {
    const messages = buildMessages(options);
    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(validator.validate('mensagem', message).errors).toEqual([]);
    }
    expect(messages.map((m) => m.medidas[0]!.valor)).toEqual([100, 102.5, 105, 107.5]);
    expect(messages.map((m) => m.timestamp)).toEqual([
      '2026-10-25T12:00:00.000Z',
      '2026-10-25T12:01:00.000Z',
      '2026-10-25T12:02:00.000Z',
      '2026-10-25T12:03:00.000Z',
    ]);
    expect(new Set(messages.map((m) => m.id_mensagem)).size).toBe(4);
  });

  it('corrompe as K primeiras posições pedidas, removendo a versao', () => {
    const messages = buildMessages({ ...options, invalidAt: [1, 3] });
    const invalid = messages.map((m) => !validator.validate('mensagem', m).valid);
    expect(invalid).toEqual([false, true, false, true]);
  });

  it('monta um lote válido com as mensagens', () => {
    const batch = buildBatch(buildMessages(options), 'borda-01');
    expect(validator.validate('lote', batch).errors).toEqual([]);
    expect(batch.origem).toBe('borda-01');
  });

  it('monta o tópico do contrato', () => {
    expect(topicFor(options)).toBe('inquilino-a/site-a/dominio-a/nivel-01/telemetria');
  });
});
