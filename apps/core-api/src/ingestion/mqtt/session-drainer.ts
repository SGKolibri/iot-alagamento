import mqtt from 'mqtt';

export interface DrainOptions {
  url: string;
  username?: string;
  password?: string;
  clientIds: string[];
  // Assinaturas a remover da sessão (o grupo compartilhado da ingestão).
  topics: string[];
  handle: (topic: string, payload: Buffer) => Promise<void>;
  // Sem mensagem nova por este tempo, a fila da sessão é considerada vazia.
  idleMs?: number;
}

export interface DrainResult {
  clientId: string;
  drained: number;
}

async function waitIdle(state: { last: number; busy: number }, idleMs: number): Promise<void> {
  for (;;) {
    if (state.busy === 0 && Date.now() - state.last >= idleMs) return;
    await new Promise((r) => setTimeout(r, Math.min(idleMs, 200)));
  }
}

// Esvazia sessões persistentes órfãs pelo mesmo pipeline da ingestão e as apaga (ADR-017).
// Para cada identificador: conecta com a sessão (clean: false), processa e confirma o que
// estava na fila, sai do grupo compartilhado, processa o que ainda chegar e, por fim, conecta
// com clean: true, o que apaga a sessão no broker. Erro no pipeline interrompe a drenagem
// daquela sessão sem confirmar a mensagem, que continua guardada.
export async function drainSessions(options: DrainOptions): Promise<DrainResult[]> {
  const idleMs = options.idleMs ?? 2_000;
  const results: DrainResult[] = [];
  for (const clientId of options.clientIds) {
    const state = { last: Date.now(), busy: 0, drained: 0, error: undefined as unknown };
    const client = mqtt.connect(options.url, {
      clientId,
      clean: false,
      reconnectPeriod: 0,
      username: options.username,
      password: options.password,
    });
    // O processador entra antes da conexão: a fila da sessão chega logo depois do CONNACK.
    client.handleMessage = (packet, done) => {
      state.busy += 1;
      options.handle(packet.topic, packet.payload as Buffer).then(
        () => {
          state.drained += 1;
          state.busy -= 1;
          state.last = Date.now();
          done();
        },
        (error: unknown) => {
          state.busy -= 1;
          state.error = error;
          done(error as Error);
        },
      );
    };
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('error', reject);
    });
    await waitIdle(state, idleMs);
    await client.unsubscribeAsync(options.topics);
    state.last = Date.now();
    await waitIdle(state, idleMs);
    await client.endAsync();
    if (state.error)
      throw new Error(`drenagem de ${clientId} interrompida: ${String(state.error)}`);
    const cleaner = await mqtt.connectAsync(options.url, {
      clientId,
      clean: true,
      reconnectPeriod: 0,
      username: options.username,
      password: options.password,
    });
    await cleaner.endAsync();
    results.push({ clientId, drained: state.drained });
  }
  return results;
}
