import type { MessageOutcome } from '@iot/domain';
import { messageResult } from './responses';

const outcome = (overrides: Partial<MessageOutcome>): MessageOutcome => ({
  status: 'accepted',
  issues: [],
  measurements: [],
  ...overrides,
});

describe('ResultadoMensagem (ADR-012)', () => {
  it('traz a posição e o id da mensagem aceita', () => {
    expect(messageResult(outcome({ messageId: 'id-1' }), 3)).toEqual({
      indice: 3,
      id_mensagem: 'id-1',
      resultado: 'aceita',
    });
  });

  it('recusada sem id devolve null e os erros por campo', () => {
    expect(
      messageResult(
        outcome({
          status: 'refused',
          issues: [{ path: '/id_mensagem', rule: 'required', message: 'campo obrigatório' }],
        }),
        1,
      ),
    ).toEqual({
      indice: 1,
      id_mensagem: null,
      resultado: 'recusada',
      erros: [{ caminho: '/id_mensagem', regra: 'required', mensagem: 'campo obrigatório' }],
    });
  });

  it('duplicada não traz erros', () => {
    expect(messageResult(outcome({ status: 'duplicate', messageId: 'x' }), 0)).toEqual({
      indice: 0,
      id_mensagem: 'x',
      resultado: 'duplicada',
    });
  });
});
