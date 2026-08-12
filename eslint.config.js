'use strict';

const js = require('@eslint/js');

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  module: 'writable',
  require: 'readonly',
  exports: 'writable',
  Buffer: 'readonly',
  URL: 'readonly'
};

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules: {
      strict: ['error', 'global'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules: {
      strict: 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    ignores: [
      'node_modules/',
      'coverage/',
      'docs/',
      // Removed in Task 7, when run() is composed from the new modules.
      'src/bin/sharedNodeEnv.js'
    ]
  }
];
