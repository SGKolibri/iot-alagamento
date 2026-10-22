import {
  executeActions,
  shouldNotify,
  type ActionContext,
  type NotificationPort,
  type SuppressionPort,
  type TopicPublisherPort,
  type WebhookPort,
} from '../../src';

const NOW = new Date(Date.UTC(2026, 9, 25, 12, 0, 0));

class FakeNotifications implements NotificationPort {
  readonly sent: unknown[] = [];
  async send(notification: unknown): Promise<void> {
    this.sent.push(notification);
  }
}
class FakeWebhooks implements WebhookPort {
  readonly calls: { url: string; timeoutMs: number }[] = [];
  failures = 0;
  async post(url: string, _body: unknown, timeoutMs: number): Promise<void> {
    this.calls.push({ url, timeoutMs });
    if (this.failures-- > 0) throw new Error('tempo limite');
  }
}
class FakeTopics implements TopicPublisherPort {
  readonly published: { topic: string; payload: Record<string, unknown> }[] = [];
  async publish(topic: string, payload: Record<string, unknown>): Promise<void> {
    this.published.push({ topic, payload });
  }
}
class MemorySuppression implements SuppressionPort {
  readonly marks = new Map<string, { at: Date; severity: number }>();
  async get(key: string) {
    return this.marks.get(key) ?? null;
  }
  async set(key: string, mark: { at: Date; severity: number }) {
    this.marks.set(key, mark);
  }
}

function deps(now = NOW) {
  const delays: number[] = [];
  return {
    notifications: new FakeNotifications(),
    webhooks: new FakeWebhooks(),
    topics: new FakeTopics(),
    suppression: new MemorySuppression(),
    clock: { now: () => now },
    delay: async (ms: number) => {
      delays.push(ms);
    },
    newId: () => '00000000-0000-4000-8000-000000000001',
    delays,
  };
}

const context = (severity: ActionContext['severity'] = 'alta'): ActionContext => ({
  tenantId: 'tenant-a',
  rule: { id: 'rule-a', name: 'regra a', version: 1 },
  device: {
    id: 'device-a',
    slug: 'device-a',
    topic: { tenant: 't', site: 's', domain: 'd', device: 'device-a' },
  },
  alarmId: 'alarm-1',
  severity,
  kind: 'abertura',
  occurredAt: NOW,
  quantity: 'level',
  value: 42,
});

describe('7. ações como estratégias separadas', () => {
  it('notificar envia pela porta com os canais e os dados do alarme', async () => {
    const d = deps();
    const results = await executeActions(
      [{ type: 'notify', channels: ['email', 'mensageria'] }],
      context(),
      d,
    );
    expect(results).toEqual([{ type: 'notify', status: 'ok' }]);
    expect(d.notifications.sent).toEqual([
      {
        tenantId: 'tenant-a',
        channels: ['email', 'mensageria'],
        ruleId: 'rule-a',
        ruleName: 'regra a',
        deviceId: 'device-a',
        alarmId: 'alarm-1',
        severity: 'alta',
        kind: 'abertura',
        occurredAt: NOW,
        quantity: 'level',
        value: 42,
      },
    ]);
  });

  it('o webhook repete 3 vezes com espera crescente e desiste', async () => {
    const d = deps();
    d.webhooks.failures = 10;
    const results = await executeActions(
      [{ type: 'webhook', url: 'https://x.invalid/h', timeoutMs: 800 }],
      context(),
      d,
    );
    expect(results).toEqual([
      { type: 'webhook', status: 'falhou', attempts: 3, error: 'tempo limite' },
    ]);
    expect(d.webhooks.calls).toEqual(Array(3).fill({ url: 'https://x.invalid/h', timeoutMs: 800 }));
    expect(d.delays).toEqual([500, 1000]);
  });

  it('o webhook que responde na segunda tentativa conta como entregue, com tempo limite padrão de 5 s', async () => {
    const d = deps();
    d.webhooks.failures = 1;
    expect(
      await executeActions([{ type: 'webhook', url: 'https://x.invalid/h' }], context(), d),
    ).toEqual([{ type: 'webhook', status: 'ok', attempts: 2 }]);
    expect(d.webhooks.calls[0]!.timeoutMs).toBe(5000);
  });

  it('publicar em tópico envia o evento do alarme', async () => {
    const d = deps();
    await executeActions([{ type: 'topic', topic: 'avisos/area-1' }], context(), d);
    expect(d.topics.published).toEqual([
      {
        topic: 'avisos/area-1',
        payload: {
          tipo: 'alarme',
          regra_id: 'rule-a',
          dispositivo_id: 'device-a',
          alarme_id: 'alarm-1',
          severidade: 'alta',
          ocorrido_em: NOW.toISOString(),
          grandeza: 'level',
          valor: 42,
        },
      },
    ]);
  });

  it('enviar comando publica uma mensagem canônica no tópico de comando do dispositivo', async () => {
    const d = deps();
    await executeActions(
      [{ type: 'command', name: 'ligar', parameters: { minutos: 5 } }],
      context(),
      d,
    );
    expect(d.topics.published).toEqual([
      {
        topic: 't/s/d/device-a/comando',
        payload: {
          versao: '1.0',
          id_mensagem: '00000000-0000-4000-8000-000000000001',
          dispositivo: 'device-a',
          tipo: 'comando',
          timestamp: NOW.toISOString(),
          comando: { nome: 'ligar', parametros: { minutos: 5 } },
        },
      },
    ]);
  });

  it('gerar_alarme é tratado pelo motor e não pelas estratégias', async () => {
    expect(await executeActions([{ type: 'alarm', severity: 'alta' }], context(), deps())).toEqual(
      [],
    );
  });

  it('a falha de uma ação não impede as outras', async () => {
    const d = deps();
    d.webhooks.failures = 10;
    const results = await executeActions(
      [
        { type: 'webhook', url: 'https://x.invalid/h' },
        { type: 'notify', channels: ['email'] },
      ],
      context(),
      d,
    );
    expect(results.map((r) => r.status)).toEqual(['falhou', 'ok']);
  });

  it('a supressão bloqueia o segundo aviso do mesmo dispositivo na janela, exceto em escalada', async () => {
    const d = deps();
    const notify = [{ type: 'notify' as const, channels: ['email'], suppressionS: 900 }];
    expect((await executeActions(notify, context('alta'), d))[0]!.status).toBe('ok');
    expect((await executeActions(notify, context('alta'), d))[0]!.status).toBe('suprimida');
    expect((await executeActions(notify, context('media'), d))[0]!.status).toBe('suprimida');
    expect((await executeActions(notify, context('critica'), d))[0]!.status).toBe('ok');
    expect(d.notifications.sent).toHaveLength(2);
  });

  it('depois da janela, o aviso volta a sair', async () => {
    const d = deps();
    const notify = [{ type: 'notify' as const, channels: ['email'], suppressionS: 900 }];
    await executeActions(notify, context(), d);
    const later = {
      ...deps(new Date(NOW.getTime() + 900_000)),
      suppression: d.suppression,
      notifications: d.notifications,
    };
    expect((await executeActions(notify, context(), later))[0]!.status).toBe('ok');
  });

  it('regra de suprimir avisos', () => {
    const now = NOW.getTime();
    expect(shouldNotify(null, now, 60, 1)).toBe(true);
    expect(shouldNotify({ at: new Date(now - 59_999), severity: 1 }, now, 60, 1)).toBe(false);
    expect(shouldNotify({ at: new Date(now - 60_000), severity: 1 }, now, 60, 1)).toBe(true);
    expect(shouldNotify({ at: new Date(now), severity: 1 }, now, 60, 2)).toBe(true);
    expect(shouldNotify({ at: new Date(now), severity: 1 }, now, 0, 1)).toBe(true);
  });

  it('aviso de ausência (sem alarme) sai sem severidade', async () => {
    const d = deps();
    const ctx: ActionContext = {
      ...context(),
      kind: 'ausencia',
      alarmId: undefined,
      severity: undefined,
      value: undefined,
    };
    await executeActions([{ type: 'notify', channels: ['email'] }], ctx, d);
    expect(d.notifications.sent[0]).toMatchObject({
      kind: 'ausencia',
      severity: undefined,
      alarmId: undefined,
    });
  });
});
