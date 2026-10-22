import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

// O Jest não lê o .env. Para quem configura o Testcontainers por lá (por exemplo, hosts com
// SELinux; ver README), copia só as variáveis TESTCONTAINERS_* que o ambiente ainda não definiu.
const file = join(resolve(__dirname, '../../../..'), '.env');
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (key.startsWith('TESTCONTAINERS_') && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
