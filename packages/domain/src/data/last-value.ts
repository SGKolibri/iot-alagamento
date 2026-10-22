// RF-DAD-02: o último valor segue o horário da medição. Medição mais antiga que a guardada nunca
// sobrescreve, e a mesma medição repetida (evento repetido no barramento) não altera nada.
export function shouldReplaceLastValue(stored: Date | null, incoming: Date): boolean {
  return stored === null || incoming.getTime() > stored.getTime();
}
