const base = require('../../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test'],
  collectCoverageFrom: ['src/**/*.ts', '!src/cli.ts'],
  coverageThreshold: { global: { statements: 80, branches: 70, functions: 80, lines: 80 } },
};
