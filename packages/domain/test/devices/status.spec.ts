import { evaluateDeviceStatus } from '../../src';

const now = new Date('2026-10-25T12:00:00Z');
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('evaluateDeviceStatus (RF-DIS-06)', () => {
  it('sensor de 1 min vira SEM_SINAL depois de 3 intervalos', () => {
    expect(evaluateDeviceStatus(ago(180), 60, now)).toBe('ONLINE');
    expect(evaluateDeviceStatus(ago(181), 60, now)).toBe('SEM_SINAL');
  });

  it('sensor de hora em hora não aparece offline depois de 5 min', () => {
    expect(evaluateDeviceStatus(ago(300), 3600, now)).toBe('ONLINE');
    expect(evaluateDeviceStatus(ago(3 * 3600 + 1), 3600, now)).toBe('SEM_SINAL');
  });

  it('a tolerância em intervalos é configurável', () => {
    expect(evaluateDeviceStatus(ago(181), 60, now, 5)).toBe('ONLINE');
    expect(evaluateDeviceStatus(ago(301), 60, now, 5)).toBe('SEM_SINAL');
  });

  it('dispositivo que nunca enviou fica NUNCA_CONECTADO', () => {
    expect(evaluateDeviceStatus(null, 60, now)).toBe('NUNCA_CONECTADO');
  });

  it('contato com horário no futuro conta como online', () => {
    expect(evaluateDeviceStatus(new Date(now.getTime() + 5000), 60, now)).toBe('ONLINE');
  });
});
