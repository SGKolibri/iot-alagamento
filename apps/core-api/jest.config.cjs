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
  testPathIgnorePatterns: process.env.LOAD_TEST
    ? ['/node_modules/']
    : ['/node_modules/', '\\.load\\.spec\\.ts$'],
  setupFiles: ['<rootDir>/test/support/testcontainers-from-dotenv.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.cli.ts', '!src/generated/**'],
  coverageThreshold: { global: { statements: 70, branches: 70, functions: 70, lines: 70 } },
};
