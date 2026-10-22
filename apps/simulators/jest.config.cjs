const base = require('../../jest.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/src'],
  // Os pacotes do workspace são consumidos pelo código-fonte, sem build.
  moduleNameMapper: { '^@iot/(domain|contracts)$': '<rootDir>/../../packages/$1/src' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/cli.ts', '!src/index.ts'],
};
