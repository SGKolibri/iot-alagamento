import type { DeadLetter, DeadLetterPort } from '@iot/domain';
import type { Pool } from 'pg';

export class PostgresDeadLetters implements DeadLetterPort {
  constructor(private readonly pool: Pool) {}

  async saveAll(letters: DeadLetter[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO dead_letters (tenant_id, message_id, source, topic, payload, issues, received_at)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::jsonb[], $6::jsonb[], $7::timestamptz[])`,
      [
        letters.map((l) => l.tenantId ?? null),
        letters.map((l) => l.messageId ?? null),
        letters.map((l) => l.source),
        letters.map((l) => l.topic ?? null),
        letters.map((l) => JSON.stringify(l.payload ?? null)),
        letters.map((l) => JSON.stringify(l.issues)),
        letters.map((l) => l.receivedAt),
      ],
    );
  }
}
