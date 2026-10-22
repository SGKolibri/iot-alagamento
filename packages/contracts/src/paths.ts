import { resolve } from 'node:path';

// Os contratos canônicos ficam em docs/contracts (fonte única); o pacote só os valida.
export const CONTRACTS_DIR = resolve(__dirname, '../../../docs/contracts');
export const EXAMPLES_DIR = resolve(CONTRACTS_DIR, 'examples');

export const SCHEMA_FILES = {
  mensagem: 'canonical-message.v1.schema.json',
  lote: 'batch.v1.schema.json',
} as const;

export type ContractName = keyof typeof SCHEMA_FILES;
