/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    './index.cjs',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/jsx-runtime',
  ],
  plugins: ['react', 'react-hooks'],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/prop-types': 'off',
  },
}
