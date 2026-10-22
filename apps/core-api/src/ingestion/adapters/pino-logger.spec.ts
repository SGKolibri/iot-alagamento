import { Writable } from 'node:stream';
import pino from 'pino';
import { PinoLogger } from './pino-logger';

describe('PinoLogger (RF-OBS-02)', () => {
  it('escreve JSON, e o filho carrega o id_mensagem em todos os registros', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = new PinoLogger(pino({ level: 'debug' }, stream));
    const child = logger.child({ id_mensagem: 'abc' });

    child.debug({ etapa: 'validar' }, 'um');
    child.info({}, 'dois');
    child.warn({}, 'tres');
    child.error({}, 'quatro');

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.map((r) => r.msg)).toEqual(['um', 'dois', 'tres', 'quatro']);
    expect(records.every((r) => r.id_mensagem === 'abc')).toBe(true);
    expect(records[0]).toMatchObject({ etapa: 'validar', level: 20 });
  });
});
