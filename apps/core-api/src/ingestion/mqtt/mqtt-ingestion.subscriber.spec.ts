import type { IngestionPipeline, LoggerPort, MessageRequest } from '@iot/domain';
import type { IngestionConfig } from '../infra/config';
import { MqttIngestionSubscriber, RAW_PAYLOAD_LIMIT_BYTES } from './mqtt-ingestion.subscriber';

const silent: LoggerPort = {
  child: () => silent,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function subscriber() {
  const requests: MessageRequest[] = [];
  const pipeline = {
    ingestMessage: async (request: MessageRequest) => {
      requests.push(request);
      return { status: 'refused', issues: [], measurements: [] };
    },
  } as unknown as IngestionPipeline;
  return {
    requests,
    subject: new MqttIngestionSubscriber({} as IngestionConfig, pipeline, silent),
  };
}

describe('MqttIngestionSubscriber', () => {
  it('payload JSON segue como objeto, com o tópico decomposto', async () => {
    const { requests, subject } = subscriber();
    await subject.handle('t/s/d/dev/telemetria', Buffer.from('{"a":1}'));
    expect(requests).toEqual([
      {
        source: 'mqtt',
        topic: { tenant: 't', site: 's', domain: 'd', device: 'dev', kind: 'telemetria' },
        body: { a: 1 },
      },
    ]);
  });

  it('payload que não é JSON segue como texto bruto truncado em 2 KB', async () => {
    const { requests, subject } = subscriber();
    await subject.handle('t/s/d/dev/telemetria', Buffer.from('x'.repeat(5000)));
    const body = requests[0]!.body as string;
    expect(RAW_PAYLOAD_LIMIT_BYTES).toBe(2048);
    expect(Buffer.byteLength(body)).toBe(2048);
  });

  it('o corte não quebra caractere de mais de um byte', async () => {
    const { requests, subject } = subscriber();
    await subject.handle('t/s/d/dev/telemetria', Buffer.from('é'.repeat(3000)));
    const body = requests[0]!.body as string;
    expect(body).toBe('é'.repeat(1024));
  });

  it('tópico fora do padrão é ignorado', async () => {
    const { requests, subject } = subscriber();
    await subject.handle('t/s/telemetria', Buffer.from('{}'));
    expect(requests).toEqual([]);
  });
});
