const base = require('../../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test', '<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageThreshold: { global: { statements: 70, branches: 70, functions: 70, lines: 70 } },
};
