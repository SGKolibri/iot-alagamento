export type DeviceStatus = 'ONLINE' | 'SEM_SINAL' | 'NUNCA_CONECTADO';

export const DEFAULT_STATUS_TOLERANCE = 3;

// RF-DIS-06: o dispositivo fica SEM_SINAL quando passa mais de `tolerance` intervalos esperados
// do perfil sem contato. O horário atual vem de fora (ClockPort no chamador).
export function evaluateDeviceStatus(
  lastContactAt: Date | null,
  expectedIntervalS: number,
  now: Date,
  tolerance: number = DEFAULT_STATUS_TOLERANCE,
): DeviceStatus {
  if (lastContactAt === null) return 'NUNCA_CONECTADO';
  const silentMs = now.getTime() - lastContactAt.getTime();
  return silentMs > tolerance * expectedIntervalS * 1000 ? 'SEM_SINAL' : 'ONLINE';
}

// Evento publicado quando o estado do dispositivo muda (stream device.status_changed).
export interface DeviceStatusChanged {
  type: 'device.status_changed';
  tenantId: string;
  deviceId: string;
  deviceSlug: string;
  from: DeviceStatus;
  to: DeviceStatus;
  lastContactAt: string | null;
  at: string;
}
