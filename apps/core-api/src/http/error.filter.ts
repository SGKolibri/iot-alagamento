import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

interface ErrorBody {
  codigo: string;
  mensagem: string;
  detalhes?: unknown[];
}

// Erros do body-parser do Express (pacote http-errors): têm "type" e status 4xx.
interface BodyParserError {
  type: string;
  status: number;
  limit?: number | string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  const candidate = error as Partial<BodyParserError> | null;
  return (
    typeof candidate?.type === 'string' &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}

export const INVALID_JSON: ErrorBody = {
  codigo: 'json_invalido',
  mensagem: 'o corpo não é um JSON válido',
};

function bodyParserError(error: BodyParserError, limit: string): ErrorBody {
  if (error.type === 'entity.parse.failed') return INVALID_JSON;
  if (error.type === 'entity.too.large') {
    return { codigo: 'corpo_grande_demais', mensagem: `o corpo passa do limite de ${limit}` };
  }
  return { codigo: 'corpo_invalido', mensagem: 'o corpo da requisição não pôde ser lido' };
}

// Middleware de erro do Express, registrado logo depois do body-parser. O Nest converte o
// SyntaxError do parser em BadRequestException com a mensagem crua, e trata os demais erros
// do parser como erro interno; por isso eles são respondidos aqui, já no esquema Erro.
export function bodyParserErrorHandler(limit: string) {
  return (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
    if (isBodyParserError(error)) {
      response.status(error.status).json(bodyParserError(error, limit));
      return;
    }
    next(error);
  };
}

function isErrorBody(value: unknown): value is ErrorBody {
  const body = value as Partial<ErrorBody> | null;
  return typeof body?.codigo === 'string' && typeof body.mensagem === 'string';
}

// Filtro global: toda resposta de erro segue o esquema Erro do docs/contracts/openapi.yaml.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const { status, body } = this.toError(exception, request);
    response.status(status).json(body);
  }

  private toError(exception: unknown, request: Request): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isErrorBody(body)) return { status, body };
      // NotFoundException sem corpo próprio vem do roteador: nenhuma rota casou.
      if (status === HttpStatus.NOT_FOUND) {
        return {
          status,
          body: {
            codigo: 'nao_encontrado',
            mensagem: `rota não encontrada: ${request.method} ${request.originalUrl}`,
          },
        };
      }
      return { status, body: { codigo: 'erro_http', mensagem: exception.message } };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { codigo: 'erro_interno', mensagem: 'erro interno' },
    };
  }
}
