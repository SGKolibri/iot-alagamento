import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  evaluateDeviceStatus,
  type ClockPort,
  type DeviceStatus,
  type DeviceStatusChanged,
  type LoggerPort,
} from '@iot/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import type { IngestionConfig } from '../ingestion/infra/config';
import { APP_CONFIG, CLOCK, PG_POOL, REDIS } from '../infra/tokens';
import { LOGGER } from '../ingestion/tokens';

const INGESTED = 'measurement.ingested';
const STATUS_CHANGED = 'device.status_changed';
const GROUP = 'device-status';
const STREAM_MAXLEN = 100_000;

async function publish(redis: Redis, event: DeviceStatusChanged): Promise<void> {
  await redis.xadd(
    STATUS_CHANGED,
    'MAXLEN',
    '~',
    STREAM_MAXLEN,
    '*',
    'evento',
    JSON.stringify(event),
  );
}

interface IngestedEvent {
  tenantId: string;
  deviceId: string;
  timestamp: string;
  late: boolean;
}

// RF-DIS-06: consumidor de measurement.ingested que atualiza o último contato. Tolera eventos
// repetidos (ADR-011): GREATEST mantém o contato mais recente, e o evento de mudança de estado
// só sai quando o estado anterior não era ONLINE.
@Injectable()
export class DeviceStatusConsumer implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private loop?: Promise<void>;
  private reader?: Redis;
  private readonly consumer = `core-api-${process.pid}`;

  constructor(
    @Inject(APP_CONFIG) private readonly config: IngestionConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.backgroundJobs) return;
    // Conexão própria: a leitura bloqueante não pode ocupar a conexão compartilhada.
    this.reader = this.redis.duplicate();
    try {
      // '$': um grupo novo começa no fim do stream, sem reprocessar o histórico.
      await this.reader.xgroup('CREATE', INGESTED, GROUP, '$', 'MKSTREAM');
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
    this.running = true;
    this.loop = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
    this.reader?.disconnect();
  }

  private async poll(): Promise<void> {
    // Primeiro as pendentes deste consumidor (falha anterior), depois as novas.
    let cursor = '0';
    while (this.running) {
      try {
        const result = (await this.reader!.xreadgroup(
          'GROUP',
          GROUP,
          this.consumer,
          'COUNT',
          500,
          'BLOCK',
          500,
          'STREAMS',
          INGESTED,
          cursor,
        )) as [string, [string, string[]][]][] | null;
        const entries = result?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) cursor = '>';
        for (const [id, fields] of entries) {
          await this.handle(JSON.parse(fields[1]!) as IngestedEvent);
          await this.reader!.xack(INGESTED, GROUP, id);
        }
      } catch (error) {
        if (!this.running) return;
        this.logger.error(
          { erro: String(error) },
          'falha no consumidor de estado dos dispositivos',
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async handle(event: IngestedEvent): Promise<void> {
    // Medição atrasada não diz nada sobre o contato atual (RF-ING-04).
    if (event.late) return;
    const { rows } = await this.pool.query<{
      previous: DeviceStatus;
      slug: string;
      last_contact_at: Date;
    }>(
      `WITH prev AS (
         SELECT status FROM devices WHERE id = $1 AND tenant_id = $2 FOR UPDATE
       )
       UPDATE devices d
          SET last_contact_at = GREATEST(COALESCE(d.last_contact_at, $3::timestamptz), $3::timestamptz),
              status = 'ONLINE'
         FROM prev
        WHERE d.id = $1 AND d.tenant_id = $2
       RETURNING prev.status AS previous, d.slug, d.last_contact_at`,
      [event.deviceId, event.tenantId, event.timestamp],
    );
    const updated = rows[0];
    if (!updated || updated.previous === 'ONLINE') return;
    await publish(this.redis, {
      type: STATUS_CHANGED,
      tenantId: event.tenantId,
      deviceId: event.deviceId,
      deviceSlug: updated.slug,
      from: updated.previous,
      to: 'ONLINE',
      lastContactAt: updated.last_contact_at.toISOString(),
      at: this.clock.now().toISOString(),
    });
  }
}

// RF-DIS-06: varredura periódica que marca SEM_SINAL pela regra do domínio. A atualização
// condicional garante um único evento por mudança, mesmo com varreduras simultâneas.
@Injectable()
export class DeviceStatusSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly config: IngestionConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  onModuleInit(): void {
    if (!this.config.backgroundJobs) return;
    this.timer = setInterval(() => {
      this.sweep(this.clock.now()).catch((error: unknown) =>
        this.logger.error({ erro: String(error) }, 'falha na varredura de estado dos dispositivos'),
      );
    }, this.config.statusSweepMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Devolve os ids que passaram a SEM_SINAL nesta varredura.
  async sweep(now: Date): Promise<string[]> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      slug: string;
      last_contact_at: Date;
      expected_interval_s: number;
    }>(
      `SELECT d.id, d.tenant_id, d.slug, d.last_contact_at, p.expected_interval_s
         FROM devices d JOIN device_profiles p ON p.id = d.profile_id AND p.tenant_id = d.tenant_id
        WHERE d.status = 'ONLINE'`,
    );
    const changed: string[] = [];
    for (const device of rows) {
      if (
        evaluateDeviceStatus(device.last_contact_at, device.expected_interval_s, now) !==
        'SEM_SINAL'
      )
        continue;
      const result = await this.pool.query(
        `UPDATE devices SET status = 'SEM_SINAL'
          WHERE id = $1 AND status = 'ONLINE' AND last_contact_at = $2`,
        [device.id, device.last_contact_at],
      );
      if (result.rowCount !== 1) continue;
      changed.push(device.id);
      await publish(this.redis, {
        type: STATUS_CHANGED,
        tenantId: device.tenant_id,
        deviceId: device.id,
        deviceSlug: device.slug,
        from: 'ONLINE',
        to: 'SEM_SINAL',
        lastContactAt: device.last_contact_at.toISOString(),
        at: now.toISOString(),
      });
    }
    return changed;
  }
}
