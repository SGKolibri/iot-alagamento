import { HttpException, HttpStatus } from '@nestjs/common';
import type { Issue } from '@iot/domain';
import { fieldErrors } from '../ingestion/http/responses';
import { ListQueryError, parseListQuery, type ListQuery } from '../http/list-query';

// Respostas de erro no esquema Erro do openapi.yaml.
export function badRequest(issues: Issue[], message = 'requisição inválida'): HttpException {
  return new HttpException(
    { codigo: 'validacao', mensagem: message, detalhes: fieldErrors(issues) },
    HttpStatus.BAD_REQUEST,
  );
}

export function notFound(what: string): HttpException {
  return new HttpException(
    { codigo: 'nao_encontrado', mensagem: `${what} não encontrado no inquilino` },
    HttpStatus.NOT_FOUND,
  );
}

export function conflict(message: string): HttpException {
  return new HttpException({ codigo: 'conflito', mensagem: message }, HttpStatus.CONFLICT);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Id fora do formato UUID é tratado como inexistente (o banco recusaria o tipo).
export function requireUuid(id: string, what: string): string {
  if (!UUID.test(id)) throw notFound(what);
  return id;
}

export function listQuery(
  query: Record<string, unknown>,
  sortable: Record<string, string>,
  defaultSort: string,
): ListQuery {
  try {
    return parseListQuery(query, { sortable, defaultSort });
  } catch (error) {
    if (error instanceof ListQueryError)
      throw badRequest(error.issues, 'parâmetros de listagem inválidos');
    throw error;
  }
}

export function page<T>(items: T[], total: number, query: ListQuery) {
  return { itens: items, pagina: query.page, limite: query.limit, total };
}

// Erros do banco que viram resposta do contrato: chave única (conflito) e geometria inválida.
export function mapDatabaseError(error: unknown, what: string): never {
  const code = (error as { code?: string }).code;
  const dbCode = (
    error as {
      meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } };
    }
  ).meta;
  const original = dbCode?.code ?? dbCode?.driverAdapterError?.cause?.originalCode;
  if (code === 'P2002' || original === '23505')
    throw conflict(`${what} com este slug já existe no inquilino`);
  if (original === '23514' || original === 'XX000' || original === '22023') {
    throw badRequest([{ path: '/geometria', rule: 'geometria', message: 'geometria inválida' }]);
  }
  throw error;
}
