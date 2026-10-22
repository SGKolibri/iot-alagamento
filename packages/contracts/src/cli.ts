// pnpm contracts:validate: valida schemas, exemplos, AsyncAPI e OpenAPI (RNF-13).
import { checkContracts } from './check';

async function main(): Promise<void> {
  const results = await checkContracts();
  for (const result of results) {
    const mark = result.ok ? '✔' : '✘';
    console.log(`${mark} ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} de ${results.length} verificações falharam.`);
    process.exit(1);
  }
  console.log(`\nContratos OK: ${results.length} verificações.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
