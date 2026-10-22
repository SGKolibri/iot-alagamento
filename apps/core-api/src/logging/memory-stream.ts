import { Writable } from 'node:stream';

// Destino em memória para o pino nos testes: guarda cada linha JSON já decodificada.
export function memoryStream(): { stream: Writable; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        records.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  return { stream, records };
}
