// Porta do autor das ações sobre alarmes. Na T3 o adaptador lê o usuário do token do Keycloak.
export interface ActorRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface ActorContextPort {
  resolve(request: ActorRequest): string | null;
}

export const ACTOR_CONTEXT = Symbol('ACTOR_CONTEXT');
