import { createResponseValidator, type ResponseValidator } from '@iot/contracts';
import { toIssues } from '../ingestion/adapters/ajv-schema-validator';
import { badRequest } from './http-errors';

export const REQUEST_VALIDATOR = Symbol('REQUEST_VALIDATOR');

// Valida o corpo das requisições contra os esquemas do openapi.yaml: o contrato é a regra.
export class RequestValidator {
  private constructor(private readonly validator: ResponseValidator) {}

  static async create(): Promise<RequestValidator> {
    return new RequestValidator(await createResponseValidator());
  }

  assert<T>(schema: string, body: unknown): T {
    const result = this.validator.validate(schema, body);
    if (!result.valid) throw badRequest(toIssues(result.errors), 'corpo fora do contrato');
    return body as T;
  }
}
