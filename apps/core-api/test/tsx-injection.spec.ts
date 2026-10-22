import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// O start:dev e o seed rodam pelo tsx, que não emite metadados de decorator: toda injeção
// precisa de @Inject explícito. Aqui o app sobe pelo tsx, como em desenvolvimento.
describe('injeção de dependências sem metadados de decorator (tsx)', () => {
  it('nenhuma dependência dos controllers fica undefined', () => {
    const output = execFileSync('npx', ['tsx', join(__dirname, 'support/tsx-injection-probe.ts')], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MQTT_HOST: '', REDIS_HOST: '', LOG_LEVEL: 'silent' },
    });
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({ missing: [] });
  }, 60_000);
});
