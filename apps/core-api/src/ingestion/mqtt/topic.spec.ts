import { INGESTION_TOPICS, parseTopic, sharedSubscriptions } from './topic';

describe('tópicos MQTT de ingestão', () => {
  it('assina telemetria, evento e estado com curingas', () => {
    expect(INGESTION_TOPICS).toEqual(['+/+/+/+/telemetria', '+/+/+/+/evento', '+/+/+/+/estado']);
  });

  it('extrai inquilino, site, domínio, dispositivo e tipo', () => {
    expect(parseTopic('t/s/d/dev/telemetria')).toEqual({
      tenant: 't',
      site: 's',
      domain: 'd',
      device: 'dev',
      kind: 'telemetria',
    });
  });

  it.each([
    't/s/d/telemetria',
    't/s/d/dev/x/telemetria',
    't//d/dev/telemetria',
    't/s/d/dev/comando',
  ])('recusa %s', (topic) => {
    expect(parseTopic(topic)).toBeNull();
  });

  it('assinatura compartilhada reparte as mensagens entre as conexões do grupo', () => {
    expect(sharedSubscriptions('core-api')).toEqual([
      '$share/core-api/+/+/+/+/telemetria',
      '$share/core-api/+/+/+/+/evento',
      '$share/core-api/+/+/+/+/estado',
    ]);
  });
});
