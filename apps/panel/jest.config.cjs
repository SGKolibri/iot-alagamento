const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: __dirname });

/** @type {import('jest').Config} */
module.exports = createJestConfig({
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  roots: ['<rootDir>/test'],
  collectCoverageFrom: ['app/**/*.{ts,tsx}', '!app/layout.tsx'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
});
