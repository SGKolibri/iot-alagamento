const base = require('../../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test', '<rootDir>/src'],
  // Os pacotes do workspace são consumidos pelo código-fonte, sem build.
  moduleNameMapper: {
    // O cliente gerado do Prisma importa com extensão .js.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@iot/(domain|contracts)$': '<rootDir>/../../packages/$1/src',
    '^@iot/simulators$': '<rootDir>/../simulators/src',
  },
  // Testes de carga (*.load.spec.ts) só rodam com LOAD_TEST=1 (pnpm test:load).
  // Desempenho (*.perf.spec.ts) só com PERF_TEST=1 (pnpm test:perf), sobre o compose.
  testPathIgnorePatterns: [
    '/node_modules/',
    ...(process.env.LOAD_TEST ? [] : ['\\.load\\.spec\\.ts$']),
    ...(process.env.PERF_TEST ? [] : ['\\.perf\\.spec\\.ts$']),
  ],
  setupFiles: ['<rootDir>/test/support/testcontainers-from-dotenv.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.cli.ts', '!src/generated/**'],
  coverageThreshold: { global: { statements: 70, branches: 70, functions: 70, lines: 70 } },
};
