import pino from 'pino';
import { memoryStream } from './memory-stream';
import { PinoNestLogger } from './pino-nest-logger';

describe('PinoNestLogger (logs do NestJS em JSON)', () => {
  it('mapeia os níveis do Nest para o pino, com o contexto como campo', () => {
    const { stream, records } = memoryStream();
    const logger = new PinoNestLogger(pino({ level: 'trace' }, stream));

    logger.verbose('v', 'Ctx');
    logger.debug('d', 'Ctx');
    logger.log('l', 'Ctx');
    logger.warn('w', 'Ctx');
    logger.error('e', 'pilha', 'Ctx');
    logger.fatal('f', 'Ctx');

    expect(records.map((r) => [r.level, r.msg, r.contexto])).toEqual([
      [10, 'v', 'Ctx'],
      [20, 'd', 'Ctx'],
      [30, 'l', 'Ctx'],
      [40, 'w', 'Ctx'],
      [50, 'e', 'Ctx'],
      [60, 'f', 'Ctx'],
    ]);
    expect(records[4]).toMatchObject({ pilha: 'pilha' });
  });

  it('aceita objeto como mensagem e erro sem pilha', () => {
    const { stream, records } = memoryStream();
    const logger = new PinoNestLogger(pino(stream));
    logger.log({ a: 1 });
    logger.error('só a mensagem');
    expect(records[0]).toMatchObject({ a: 1 });
    expect(records[1]).toMatchObject({ msg: 'só a mensagem' });
    expect(records[1]).not.toHaveProperty('pilha');
  });
});
