module.exports = {
  // Stop the config cascade at the package that extends this — without it,
  // ESLint keeps walking up ancestor directories (e.g. out of a git worktree
  // into an enclosing checkout) and loads plugins twice.
  root: true,
  extends: ['oclif', 'prettier'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  env: {
    node: true,
    commonjs: true,
  },
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  ignorePatterns: [
    // Test fixtures are verbatim platform data (e.g. Twitter's window.YTD
    // export JS), not source.
    '**/__fixtures__/',
    'dist/',
    'node_modules/',
    '.next/',
    'build/',
    'coverage/',
    'test-dist/',
    '*.min.js',
    '*.d.ts.map',
    '*.js.map',
    '*.tsbuildinfo',
  ],
  rules: {
    // Relaxed rules for gradual adoption
    'no-console': 'warn',
    'no-unused-vars': 'off', // Disable base rule in favor of TypeScript version
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // Disable problematic perfectionist rules initially
    'perfectionist/sort-imports': 'off',
    'perfectionist/sort-objects': 'off',
    'perfectionist/sort-interfaces': 'off',
    'perfectionist/sort-union-types': 'off',
    'perfectionist/sort-classes': 'off',
    'perfectionist/sort-named-imports': 'off',
    'perfectionist/sort-jsx-props': 'off',

    // Disable other strict rules
    '@typescript-eslint/no-explicit-any': 'warn',
    'unicorn/filename-case': 'off',
    'unicorn/consistent-destructuring': 'off',
    'perfectionist/sort-intersection-types': 'off',
    'new-cap': 'warn',
    eqeqeq: 'warn',
    'import/no-named-as-default-member': 'warn',

    // Disable more noisy rules
    'no-useless-constructor': 'warn',
    'no-warning-comments': 'off', // Allow TODO comments
    'unicorn/no-object-as-default-parameter': 'off',
    'no-await-in-loop': 'warn', // Often intentional in ETL
    'unicorn/no-useless-switch-case': 'off',
    'unicorn/prefer-spread': 'warn', // Array#concat() sometimes more readable
    'guard-for-in': 'warn', // for-in loops sometimes don't need guard
    'no-unused-expressions': 'warn', // Sometimes used for side effects
    'n/no-extraneous-import': 'warn', // May be incorrect in monorepo
    'n/no-unpublished-import': 'off', // Allow dev dependencies in config files
    'no-promise-executor-return': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn', // @ts-ignore sometimes needed
    'unicorn/better-regex': 'off', // Subjective improvements
    'dot-notation': 'warn', // Sometimes brackets needed
    'unicorn/switch-case-braces': 'off', // Style preference
    'unicorn/prefer-ternary': 'off', // if/else is often clearer
    radix: 'off', // parseInt radix parameter not always needed
    'unicorn/text-encoding-identifier-case': 'off', // utf-8 vs utf8 preference
    camelcase: 'warn', // External APIs often use snake_case
    'padding-line-between-statements': 'off', // Too aggressive formatting
    'unicorn/no-array-reduce': 'off', // Reduce is often appropriate
    'no-implicit-coercion': 'warn', // Sometimes intentional
    'import/no-named-as-default': 'warn', // May be incorrect
    'n/no-unsupported-features/es-syntax': [
      'error',
      {
        version: '>=18.0.0', // Modern Node.js version with full ES2022 support
      },
    ],
    'n/no-unsupported-features/es-builtins': [
      'error',
      {
        version: '>=18.0.0', // Modern Node.js version with full ES2022 support
      },
    ],
    'n/no-unsupported-features/node-builtins': [
      'error',
      {
        version: '>=18.0.0', // Modern Node.js version with full Node.js builtin support
      },
    ],
    'n/no-missing-import': 'off', // Incompatible with TypeScript module resolution
    'max-nested-callbacks': ['warn', 6], // Allow more nested callbacks for complex async operations
    'max-params': ['warn', 8], // Increase from default 4 for data processing methods
    'max-depth': ['warn', 5], // Increase from default 4 for complex data processing
    complexity: 'off', // Disable complexity warnings
  },
  overrides: [
    {
      // Config files can use CommonJS
      files: ['*.cjs', '*.config.js', '**/eslint-config/**/*.js', '**/prettier-config/**/*.js'],
      env: {
        commonjs: true,
      },
      globals: {
        module: 'readonly',
        exports: 'readonly',
      },
      rules: {
        'unicorn/prefer-module': 'off',
        'no-undef': 'off',
      },
    },
    {
      // Allow scripts to use console and process.exit
      files: ['**/scripts/**/*.ts', '**/scripts/**/*.js', '**/*.test.js', '**/*.test.ts'],
      rules: {
        'no-console': 'off',
        'n/no-process-exit': 'off',
        'unicorn/no-process-exit': 'off',
        'unicorn/prefer-top-level-await': 'off',
      },
    },
    {
      // TypeScript files have different scoping rules
      files: ['**/*.ts', '**/*.tsx'],
      globals: {
        NodeJS: 'readonly', // Node.js namespace types
        __dirname: 'readonly', // CommonJS global
        __filename: 'readonly', // CommonJS global
      },
      rules: {
        'no-redeclare': 'off', // TypeScript handles redeclaration checking
        '@typescript-eslint/no-redeclare': 'off', // TypeScript compiler handles this better
        'unicorn/prefer-module': 'off', // Allow CommonJS patterns in Node.js
      },
    },
    {
      // React/JSX files need different rules
      files: ['**/*.tsx', '**/*.jsx'],
      env: {
        browser: true,
      },
      rules: {
        'no-undef': 'off', // TypeScript handles this for React components
      },
    },
  ],
};
