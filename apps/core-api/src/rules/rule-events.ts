import { Injectable } from '@nestjs/common';

// Avisa quem guarda regras em memória (o motor) que as regras de um inquilino mudaram.
@Injectable()
export class RuleEvents {
  private readonly listeners: ((tenantId: string) => void)[] = [];

  onChange(listener: (tenantId: string) => void): void {
    this.listeners.push(listener);
  }

  changed(tenantId: string): void {
    for (const listener of this.listeners) listener(tenantId);
  }
}
