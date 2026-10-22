import type { WebhookPort } from '@iot/domain';

// Uma tentativa de webhook com tempo limite; repetição e espera ficam na estratégia do domínio.
export class FetchWebhook implements WebhookPort {
  async post(url: string, body: unknown, timeoutMs: number): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError')
        throw new Error(`webhook sem resposta em ${timeoutMs} ms`, { cause: error });
      throw error;
    }
    await response.body?.cancel();
    if (!response.ok) throw new Error(`webhook respondeu ${response.status}`);
  }
}
