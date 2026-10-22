import { Logger, type ArgumentsHost } from '@nestjs/common';
import { ErrorFilter } from './error.filter';

function host() {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = { method: 'POST', originalUrl: '/api/v1/ingestao' };
  const argumentsHost = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { response, argumentsHost };
}

describe('ErrorFilter', () => {
  it('erro interno vira 500 no esquema Erro, sem vazar a mensagem original', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { response, argumentsHost } = host();

    new ErrorFilter().catch(new Error('senha do banco: segredo'), argumentsHost);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      codigo: 'erro_interno',
      mensagem: 'erro interno',
    });
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('segredo');
    expect(logged).toHaveBeenCalled();
  });
});
