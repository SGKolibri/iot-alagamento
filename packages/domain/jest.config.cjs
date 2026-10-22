const base = require('../../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test', '<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: { statements: 70, branches: 70, functions: 70, lines: 70 },
    './src/ingestion/': { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
};
