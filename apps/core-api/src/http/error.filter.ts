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

// Erro de parse do body-parser do Express (corpo que não é JSON válido).
function isJsonParseError(exception: unknown): boolean {
  return (exception as { type?: string } | null)?.type === 'entity.parse.failed';
}

export const INVALID_JSON: ErrorBody = {
  codigo: 'json_invalido',
  mensagem: 'o corpo não é um JSON válido',
};

// Middleware de erro do Express, registrado logo depois do body-parser. O Nest converte o
// SyntaxError do parser em BadRequestException com a mensagem crua e perde o tipo, então o
// erro de JSON precisa ser tratado antes de chegar ao filtro.
export function jsonParseErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (isJsonParseError(error)) {
    response.status(HttpStatus.BAD_REQUEST).json(INVALID_JSON);
    return;
  }
  next(error);
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
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toError(exception);
    response.status(status).json(body);
  }

  private toError(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isErrorBody(body)) return { status, body };
      return { status, body: { codigo: 'erro_http', mensagem: exception.message } };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { codigo: 'erro_interno', mensagem: 'erro interno' },
    };
  }
}
