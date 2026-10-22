import type { LoggerPort } from '@iot/domain';
import { IngestionMetrics } from '../../metrics/ingestion-metrics';
import type { IngestionConfig } from '../infra/config';
import { BrokerMonitor, DROPPED_TOPIC, STORED_TOPIC } from './broker-monitor';

function setup() {
  const errors: unknown[] = [];
  const logger = { error: (fields: unknown) => errors.push(fields) } as unknown as LoggerPort;
  const metrics = new IngestionMetrics();
  return { errors, metrics, monitor: new BrokerMonitor({} as IngestionConfig, metrics, logger) };
}

const value = async (metrics: IngestionMetrics, name: string) =>
  (await metrics.registry.getSingleMetric(name)!.get()).values[0]?.value;

describe('BrokerMonitor', () => {
  it('soma só o aumento do contador do broker e registra erro a cada aumento', async () => {
    const { monitor, metrics, errors } = setup();
    monitor.observe(DROPPED_TOPIC, 5);
    monitor.observe(DROPPED_TOPIC, 5);
    monitor.observe(DROPPED_TOPIC, 12);
    expect(await value(metrics, 'mqtt_broker_dropped_messages_total')).toBe(12);
    expect(errors).toEqual([
      { descartadas: 5, total_no_broker: 5 },
      { descartadas: 7, total_no_broker: 12 },
    ]);
  });

  it('broker reiniciado (contador menor que o anterior) conta o valor novo inteiro', async () => {
    const { monitor, metrics } = setup();
    monitor.observe(DROPPED_TOPIC, 10);
    monitor.observe(DROPPED_TOPIC, 3);
    expect(await value(metrics, 'mqtt_broker_dropped_messages_total')).toBe(13);
  });

  it('mensagens guardadas viram o medidor de pendentes; valor inválido e tópico alheio são ignorados', async () => {
    const { monitor, metrics, errors } = setup();
    monitor.observe(STORED_TOPIC, 42);
    monitor.observe(STORED_TOPIC, Number.NaN);
    monitor.observe('$SYS/outro', 9);
    expect(await value(metrics, 'mqtt_ingest_pending_messages')).toBe(42);
    expect(errors).toEqual([]);
  });
});
