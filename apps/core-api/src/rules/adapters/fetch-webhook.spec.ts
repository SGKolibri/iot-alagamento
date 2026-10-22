import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FetchWebhook } from './fetch-webhook';

describe('WebhookPort por HTTP (fetch)', () => {
  let server: Server;
  let url: string;
  const received: { path: string; type?: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ path: req.url!, type: req.headers['content-type'], body });
        if (req.url === '/lento') return; // nunca responde
        res.writeHead(req.url === '/erro' ? 503 : 204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('envia o corpo em JSON e aceita resposta 2xx', async () => {
    await new FetchWebhook().post(`${url}/ok`, { a: 1 }, 1000);
    expect(received.at(-1)).toEqual({ path: '/ok', type: 'application/json', body: '{"a":1}' });
  });

  it('resposta fora de 2xx é falha, com o código', async () => {
    await expect(new FetchWebhook().post(`${url}/erro`, {}, 1000)).rejects.toThrow(
      'webhook respondeu 503',
    );
  });

  it('servidor que não responde estoura o tempo limite', async () => {
    const started = Date.now();
    await expect(new FetchWebhook().post(`${url}/lento`, {}, 200)).rejects.toThrow(
      'webhook sem resposta em 200 ms',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
