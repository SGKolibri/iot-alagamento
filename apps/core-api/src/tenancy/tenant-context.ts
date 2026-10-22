// Porta do contexto de inquilino. Na T3 o adaptador lê a claim do token do Keycloak.
export interface TenantRef {
  id: string;
  slug: string;
}

export interface TenantRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface TenantContextPort {
  resolve(request: TenantRequest): Promise<TenantRef | null>;
}

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');
