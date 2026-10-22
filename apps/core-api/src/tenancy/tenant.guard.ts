import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { TENANT_CONTEXT, type TenantContextPort, type TenantRef } from './tenant-context';

type TenantAwareRequest = Parameters<TenantContextPort['resolve']>[0] & { tenant?: TenantRef };

// Toda rota do catálogo e da série passa por aqui: sem inquilino resolvido, 401.
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(TENANT_CONTEXT) private readonly context: TenantContextPort) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const request = execution.switchToHttp().getRequest<TenantAwareRequest>();
    const tenant = await this.context.resolve(request);
    if (!tenant) {
      throw new HttpException(
        {
          codigo: 'nao_autenticado',
          mensagem: 'inquilino ausente ou desconhecido (cabeçalho X-Tenant)',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.tenant = tenant;
    return true;
  }
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): TenantRef =>
    execution.switchToHttp().getRequest<TenantAwareRequest>().tenant!,
);
