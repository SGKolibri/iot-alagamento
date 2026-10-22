import { Parser, fromFile, DiagnosticSeverity } from '@asyncapi/parser';
import { parse, validate } from '@readme/openapi-parser';

export interface ChannelSummary {
  address: string;
  parameters: string[];
  actions: string[];
}

export interface AsyncApiResult {
  valid: boolean;
  errors: string[];
  channels: ChannelSummary[];
}

export async function validateAsyncApi(file: string): Promise<AsyncApiResult> {
  const parser = new Parser();
  const { document, diagnostics } = await fromFile(parser, file).parse();
  const errors = diagnostics
    .filter((d) => d.severity === DiagnosticSeverity.Error)
    .map((d) => `${d.path.join('.') || '(raiz)'}: ${d.message}`);
  if (!document || errors.length > 0) return { valid: false, errors, channels: [] };

  const channels = document
    .channels()
    .all()
    .map((channel) => ({
      address: channel.address() ?? '',
      parameters: channel
        .parameters()
        .all()
        .map((parameter) => parameter.id()),
      actions: channel
        .operations()
        .all()
        .map((operation) => operation.action()),
    }));
  return { valid: true, errors: [], channels };
}

export interface OpenApiResult {
  valid: boolean;
  errors: string[];
  operations: string[];
  securitySchemes: Record<string, string>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export async function validateOpenApi(file: string): Promise<OpenApiResult> {
  const result = await validate(file);
  if (!result.valid) {
    return {
      valid: false,
      errors: result.errors.map((e) => e.message),
      operations: [],
      securitySchemes: {},
    };
  }

  type Doc = {
    paths?: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], unknown>>>;
    components?: { securitySchemes?: Record<string, { type: string }> };
  };
  // parse não resolve $ref externos; basta para listar operações e esquemas de segurança.
  const doc = (await parse(file)) as unknown as Doc;
  const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => item[method]).map((m) => `${m.toUpperCase()} ${path}`),
  );
  const securitySchemes = Object.fromEntries(
    Object.entries(doc.components?.securitySchemes ?? {}).map(([name, s]) => [name, s.type]),
  );
  return { valid: true, errors: [], operations, securitySchemes };
}
