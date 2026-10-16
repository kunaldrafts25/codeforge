module.exports = {
  extends: ['@codeforge/eslint-config'],
  rules: {
    'no-console': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.ts', 'src/test/**/*.ts', 'scripts/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'prefer-const': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
  ],
}
