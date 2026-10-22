import type { ActorContextPort, ActorRequest } from './actor-context';

const MAX_LENGTH = 200;

// Adaptador de desenvolvimento: o autor vem do cabeçalho X-Ator, sem prova de identidade. Por
// isso não pode existir com NODE_ENV=production.
export class HeaderActorContext implements ActorContextPort {
  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'O ActorContext por cabeçalho X-Ator é só para desenvolvimento; em produção o autor vem do token (T3).',
      );
    }
  }

  resolve(request: ActorRequest): string | null {
    const value = request.headers['x-ator'];
    if (typeof value !== 'string') return null;
    const actor = value.trim();
    return actor.length > 0 && actor.length <= MAX_LENGTH ? actor : null;
  }
}
