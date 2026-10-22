import type { DeviceRecord, Principal } from '../model';
import type { DeviceDirectoryPort } from '../ports';
import {
  field,
  pending,
  refuse,
  type IngestionStep,
  type PipelineContext,
  type PipelineItem,
} from './step';

const STEP = 'autenticar';

// Confere a credencial (ou o tópico, quando o broker já autenticou), a coerência entre o corpo,
// o tópico e a credencial, e carrega o cadastro do dispositivo.
export class AuthenticateStep implements IngestionStep {
  readonly name = STEP;
  constructor(private readonly directory: DeviceDirectoryPort) {}

  async resolvePrincipal(credential: string | undefined): Promise<Principal | null> {
    if (!credential) return null;
    return this.directory.authenticate(credential);
  }

  async run(items: PipelineItem[], context: PipelineContext): Promise<PipelineItem[]> {
    const cache = new Map<string, Promise<DeviceRecord | null>>();
    const find = (tenant: string, device: string) => {
      const key = `${tenant}/${device}`;
      if (!cache.has(key)) cache.set(key, this.directory.findDevice(tenant, device));
      return cache.get(key)!;
    };

    for (const item of pending(items)) {
      const bodyDevice = field(item.raw, 'dispositivo');
      const target = this.target(item, context, bodyDevice);
      if (!target) continue;
      const device = await find(target.tenant, target.device);
      if (!device) {
        refuse(item, STEP, [
          {
            path: '/dispositivo',
            rule: 'cadastro',
            message: `dispositivo ${target.device} não cadastrado no inquilino ${target.tenant}`,
          },
        ]);
        continue;
      }
      const topic = context.topic;
      if (topic && (device.site !== topic.site || device.domain !== topic.domain)) {
        refuse(item, STEP, [
          {
            path: '',
            rule: 'topico',
            message: `o tópico indica site ${topic.site} e domínio ${topic.domain}, mas o dispositivo está cadastrado em ${device.site} e ${device.domain}`,
          },
        ]);
        continue;
      }
      item.device = device;
    }
    return items;
  }

  // Decide qual dispositivo buscar e recusa divergências entre corpo, tópico e credencial.
  private target(
    item: PipelineItem,
    context: PipelineContext,
    bodyDevice: string | undefined,
  ): { tenant: string; device: string } | null {
    const { topic, principal } = context;
    if (topic) {
      const bodyKind = field(item.raw, 'tipo');
      const issues = [];
      if (bodyDevice !== undefined && bodyDevice !== topic.device) {
        issues.push({
          path: '/dispositivo',
          rule: 'topico',
          message: `o dispositivo do corpo (${bodyDevice}) diverge do tópico (${topic.device})`,
        });
      }
      if (bodyKind !== undefined && bodyKind !== topic.kind) {
        issues.push({
          path: '/tipo',
          rule: 'topico',
          message: `o tipo do corpo (${bodyKind}) diverge do tópico (${topic.kind})`,
        });
      }
      if (issues.length > 0) {
        refuse(item, STEP, issues);
        return null;
      }
      return { tenant: topic.tenant, device: topic.device };
    }
    if (principal?.kind === 'device') {
      if (bodyDevice !== undefined && bodyDevice !== principal.deviceSlug) {
        refuse(item, STEP, [
          {
            path: '/dispositivo',
            rule: 'credencial',
            message: `a credencial é do dispositivo ${principal.deviceSlug}, mas a mensagem é de ${bodyDevice}`,
          },
        ]);
        return null;
      }
      return { tenant: principal.tenantSlug, device: principal.deviceSlug };
    }
    if (principal?.kind === 'edge' && bodyDevice !== undefined) {
      return { tenant: principal.tenantSlug, device: bodyDevice };
    }
    // Sem dispositivo legível no corpo: a validação recusa a mensagem na etapa seguinte.
    return null;
  }
}
