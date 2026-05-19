/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'security', 'unicorn'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
    'prettier',
  ],
  env: {
    es2022: true,
    node: true,
  },
  rules: {
    'no-console': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    'unicorn/no-null': 'off',
    'unicorn/prefer-module': 'off',
    'unicorn/filename-case': 'off',
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/no-array-reduce': 'off',
    'unicorn/no-array-for-each': 'off',
    'unicorn/prefer-top-level-await': 'off',
    'unicorn/prefer-node-protocol': 'error',
    'unicorn/no-useless-undefined': 'off',
    'unicorn/no-array-callback-reference': 'off',
    'security/detect-object-injection': 'off',
    'security/detect-non-literal-fs-filename': 'off',
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    '.next',
    '.turbo',
    'coverage',
    '**/generated/**',
    '**/.prisma/**',
  ],
}
