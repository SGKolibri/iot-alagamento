import type { Issue, MessageOutcome } from '@iot/domain';

// Formatos de resposta do docs/contracts/openapi.yaml (Erro, ErroCampo, ResultadoMensagem).
export function fieldErrors(issues: Issue[]) {
  return issues.map((issue) => ({
    caminho: issue.path,
    regra: issue.rule,
    mensagem: issue.message,
  }));
}

export function error(code: string, message: string, issues: Issue[] = []) {
  return {
    codigo: code,
    mensagem: message,
    ...(issues.length > 0 ? { detalhes: fieldErrors(issues) } : {}),
  };
}

const RESULT = { accepted: 'aceita', duplicate: 'duplicada', refused: 'recusada' } as const;

// ResultadoMensagem (ADR-012): indice é a posição no lote (0 em POST /ingestao) e
// id_mensagem fica null quando a mensagem recusada não trouxe id legível.
export function messageResult(outcome: MessageOutcome, index: number) {
  const status = outcome.status === 'unauthorized' ? 'refused' : outcome.status;
  return {
    indice: index,
    id_mensagem: outcome.messageId ?? null,
    resultado: RESULT[status],
    ...(status === 'refused' ? { erros: fieldErrors(outcome.issues) } : {}),
  };
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}
