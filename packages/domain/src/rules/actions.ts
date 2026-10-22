import type { ClockPort } from '../ports/clock.port';
import type { Action, Severity } from './model';
import type { NotificationPort, SuppressionPort, TopicPublisherPort, WebhookPort } from './ports';

export interface ActionContext {
  tenantId: string;
  rule: { id: string; name: string; version: number };
  device: {
    id: string;
    slug: string;
    topic?: { tenant: string; site: string; domain: string; device: string };
  };
  alarmId?: string;
  severity?: Severity;
  kind: 'abertura' | 'ausencia';
  occurredAt: Date;
  quantity?: string;
  value?: number;
}

export interface ActionDeps {
  notifications: NotificationPort;
  webhooks: WebhookPort;
  topics: TopicPublisherPort;
  suppression: SuppressionPort;
  clock: ClockPort;
  delay: (ms: number) => Promise<void>;
  newId: () => string;
}

export type ActionResult =
  | { type: 'notify'; status: 'ok' | 'suprimida' | 'falhou'; error?: string }
  | { type: 'webhook'; status: 'ok' | 'falhou'; attempts: number; error?: string }
  | { type: 'topic' | 'command'; status: 'ok' | 'falhou'; error?: string };

export const WEBHOOK_ATTEMPTS = 3;
export const WEBHOOK_DEFAULT_TIMEOUT_MS = 5000;
const WEBHOOK_BASE_DELAY_MS = 500;
const SEVERITY_RANK: Record<Severity, number> = { baixa: 1, media: 2, alta: 3, critica: 4 };

// Janela de supressão por dispositivo: dentro dela só passa o aviso de severidade maior (escalada).
export function shouldNotify(
  mark: { at: Date; severity: number } | null,
  now: number,
  windowS: number,
  severity: number,
): boolean {
  if (mark === null) return true;
  if (now - mark.at.getTime() >= windowS * 1000) return true;
  return severity > mark.severity;
}

async function notify(
  action: Extract<Action, { type: 'notify' }>,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionResult> {
  const now = deps.clock.now();
  const severity = ctx.severity ? SEVERITY_RANK[ctx.severity] : 0;
  const key = `${ctx.tenantId}:${ctx.device.id}`;
  if (
    !shouldNotify(
      await deps.suppression.get(key),
      now.getTime(),
      action.suppressionS ?? 0,
      severity,
    )
  ) {
    return { type: 'notify', status: 'suprimida' };
  }
  await deps.notifications.send({
    tenantId: ctx.tenantId,
    channels: action.channels,
    ruleId: ctx.rule.id,
    ruleName: ctx.rule.name,
    deviceId: ctx.device.id,
    alarmId: ctx.alarmId,
    severity: ctx.severity,
    kind: ctx.kind,
    occurredAt: ctx.occurredAt,
    quantity: ctx.quantity,
    value: ctx.value,
  });
  await deps.suppression.set(key, { at: now, severity });
  return { type: 'notify', status: 'ok' };
}

function eventPayload(ctx: ActionContext): Record<string, unknown> {
  return {
    tipo: ctx.kind === 'ausencia' ? 'ausencia' : 'alarme',
    regra_id: ctx.rule.id,
    dispositivo_id: ctx.device.id,
    alarme_id: ctx.alarmId,
    severidade: ctx.severity,
    ocorrido_em: ctx.occurredAt.toISOString(),
    grandeza: ctx.quantity,
    valor: ctx.value,
  };
}

// Até 3 tentativas, cada uma com tempo limite, e espera crescente entre elas (500 ms, 1 s).
async function webhook(
  action: Extract<Action, { type: 'webhook' }>,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.webhooks.post(
        action.url,
        eventPayload(ctx),
        action.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS,
      );
      return { type: 'webhook', status: 'ok', attempts: attempt };
    } catch (error) {
      if (attempt === WEBHOOK_ATTEMPTS) {
        const message = error instanceof Error ? error.message : String(error);
        return { type: 'webhook', status: 'falhou', attempts: attempt, error: message };
      }
      await deps.delay(WEBHOOK_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

async function command(
  action: Extract<Action, { type: 'command' }>,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionResult> {
  const address = ctx.device.topic;
  if (!address)
    return { type: 'command', status: 'falhou', error: 'dispositivo sem tópico conhecido' };
  // Mensagem canônica tipo comando (contrato v1.0) no tópico de comando do dispositivo.
  await deps.topics.publish(
    `${address.tenant}/${address.site}/${address.domain}/${address.device}/comando`,
    {
      versao: '1.0',
      id_mensagem: deps.newId(),
      dispositivo: ctx.device.slug,
      tipo: 'comando',
      timestamp: deps.clock.now().toISOString(),
      comando: {
        nome: action.name,
        ...(action.parameters ? { parametros: action.parameters } : {}),
      },
    },
  );
  return { type: 'command', status: 'ok' };
}

// RF-PRO-03: uma estratégia por tipo de ação. gerar_alarme é do motor (abre o alarme antes).
// A falha de uma ação não impede as outras e fica no resultado.
export async function executeActions(
  actions: Action[],
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    if (action.type === 'alarm') continue;
    try {
      if (action.type === 'notify') results.push(await notify(action, ctx, deps));
      else if (action.type === 'webhook') results.push(await webhook(action, ctx, deps));
      else if (action.type === 'topic') {
        await deps.topics.publish(action.topic, eventPayload(ctx));
        results.push({ type: 'topic', status: 'ok' });
      } else results.push(await command(action, ctx, deps));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ type: action.type, status: 'falhou', error: message } as ActionResult);
    }
  }
  return results;
}
