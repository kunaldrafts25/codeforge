module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.next/',
    'build/',
    '*.config.js',
    '*.config.ts',
    '*.config.mjs',
    '*.d.ts',
  ],
  rules: {
    // Strict TypeScript rules (without type-checking)
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-inferrable-types': 'error',
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/array-type': ['error', { default: 'array' }],
    '@typescript-eslint/ban-tslint-comment': 'error',
    '@typescript-eslint/class-literal-property-style': 'error',
    '@typescript-eslint/consistent-generic-constructors': 'error',
    '@typescript-eslint/no-confusing-non-null-assertion': 'error',
    '@typescript-eslint/no-duplicate-enum-values': 'error',
    '@typescript-eslint/no-extraneous-class': 'warn',
    '@typescript-eslint/no-invalid-void-type': 'error',
    '@typescript-eslint/prefer-for-of': 'warn',
    '@typescript-eslint/prefer-function-type': 'warn',
    '@typescript-eslint/unified-signatures': 'warn',

    // General code quality
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-empty': 'error',
    'no-duplicate-imports': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'multi-line'],
    'no-var': 'error',
    'object-shorthand': 'warn',
    'prefer-arrow-callback': 'warn',
    'prefer-template': 'warn',

    // Naming conventions
    camelcase: ['warn', { properties: 'never' }],
  },
  overrides: [
    // React files - strict rules
    {
      files: ['**/*.tsx'],
      plugins: ['react', 'react-hooks'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      settings: {
        react: {
          version: 'detect',
        },
      },
      rules: {
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/no-unescaped-entities': 'error',
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/rules-of-hooks': 'error',
        'react/jsx-key': 'error',
        'react/jsx-no-duplicate-props': 'error',
        'react/jsx-no-useless-fragment': 'warn',
        'react/self-closing-comp': 'warn',
        'react/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'never' }],
      },
    },
    // Config files - relaxed
    {
      files: ['*.config.js', '*.config.ts', '*.config.mjs', '.eslintrc.js'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        'no-undef': 'off',
      },
    },
  ],
}
