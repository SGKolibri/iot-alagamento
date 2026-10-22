import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Frameworks e infraestrutura que o núcleo de domínio não pode importar (CLAUDE.md, regra 2).
const forbiddenInDomain = [
  '@nestjs/*',
  '@prisma/*',
  'prisma',
  'ioredis',
  'redis',
  'mqtt',
  'sqlite3',
  'better-sqlite3',
  'better-sqlite3-multiple-ciphers',
  'next',
  'next/*',
  'react',
  'react-dom',
  'pg',
  'express',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/.stryker-tmp/**',
      '**/reports/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ group: forbiddenInDomain, message: 'O domínio não importa framework.' }] },
      ],
    },
  },
  {
    files: ['apps/panel/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
