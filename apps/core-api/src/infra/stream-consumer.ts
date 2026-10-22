import type { LoggerPort } from '@iot/domain';
import type Redis from 'ioredis';

// Consumidor de um stream do Redis num grupo (barramento interno, ADR-004). Lê primeiro as
// pendentes deste consumidor (falha anterior) e depois as novas; só confirma (XACK) o que o
// handler processou. Um grupo novo começa no fim do stream ('$'), sem reprocessar o histórico.
export class StreamConsumer {
  private running = false;
  private loop?: Promise<void>;
  private reader?: Redis;

  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly group: string,
    private readonly consumer: string,
    private readonly handle: (payload: unknown) => Promise<void>,
    private readonly logger: LoggerPort,
  ) {}

  async start(): Promise<void> {
    this.reader = this.redis.duplicate();
    try {
      await this.reader.xgroup('CREATE', this.stream, this.group, '$', 'MKSTREAM');
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
    this.running = true;
    this.loop = this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.reader?.disconnect();
  }

  private async poll(): Promise<void> {
    let cursor = '0';
    while (this.running) {
      try {
        const result = (await this.reader!.xreadgroup(
          'GROUP',
          this.group,
          this.consumer,
          'COUNT',
          500,
          'BLOCK',
          500,
          'STREAMS',
          this.stream,
          cursor,
        )) as [string, [string, string[]][]][] | null;
        const entries = result?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) cursor = '>';
        for (const [id, fields] of entries) {
          await this.handle(JSON.parse(fields[1]!) as unknown);
          await this.reader!.xack(this.stream, this.group, id);
        }
      } catch (error) {
        if (!this.running) return;
        this.logger.error(
          { stream: this.stream, grupo: this.group, erro: String(error) },
          'falha no consumidor do barramento',
        );
        // Volta a ler as pendentes, que não foram confirmadas.
        cursor = '0';
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}
