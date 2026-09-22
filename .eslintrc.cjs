module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/'],
  overrides: [{ files: ['*.cjs'], parserOptions: { sourceType: 'script' } }],
};
