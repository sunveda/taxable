import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Packages that must run unchanged on server, browser and React Native (ADR-0002, ADR-0005). */
const SHARED = [
  'packages/domain/src/**',
  'packages/rule-packs/src/**',
  'packages/tax-engine/src/**',
  'packages/importers/src/**',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Node build scripts.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
  {
    files: SHARED,
    ignores: ['**/*.test.ts'],
    rules: {
      // Platform-neutral: no Node built-ins, DOM, or React Native APIs.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'os', 'react', 'react-native'],
              message: 'Shared packages must stay platform-neutral (ADR-0005).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Shared packages must stay platform-neutral (ADR-0005).' },
        { name: 'document', message: 'Shared packages must stay platform-neutral (ADR-0005).' },
        { name: 'process', message: 'Shared packages must stay platform-neutral (ADR-0005).' },
        { name: 'fetch', message: 'The engine does no I/O (ADR-0006).' },
      ],
      // Deterministic: no clock and no randomness (ADR-0006).
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'The engine must not read the clock (ADR-0006).',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'The engine must be deterministic (ADR-0006).',
        },
        { object: 'Math', property: 'fround', message: 'Use Decimal for amounts (ADR-0008).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'The engine must not read the clock (ADR-0006).',
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Use Decimal for amounts (ADR-0008).',
        },
      ],
    },
  },
);
