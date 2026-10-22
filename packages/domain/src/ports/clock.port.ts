// Relógio como porta injetável: o domínio nunca lê a hora do sistema diretamente.
export interface ClockPort {
  now(): Date;
}
