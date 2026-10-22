// Configuração comum do Jest para os pacotes Node (CommonJS com ts-jest).
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageDirectory: '<rootDir>/coverage',
};
