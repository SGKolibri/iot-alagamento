import { Injectable } from '@nestjs/common';

// Aviso, no mesmo processo, de que o catálogo mudou (para invalidar caches, como o do
// PrismaDeviceDirectory). Em réplicas, o TTL curto do cache limita a defasagem.
@Injectable()
export class CatalogEvents {
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }
}
