const eslint = require('eslint');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', '*.config.js', 'load-tests/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      // More permissive unused vars - ignore args starting with _
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'brace-style': ['error', '1tbs'],
      // Allow trailing commas in multiline
      'comma-dangle': ['warn', 'always-multiline'],
      'comma-spacing': ['error', { before: false, after: true }],
      indent: ['error', 2],
      'linebreak-style': ['warn', 'unix'],
      quotes: ['warn', 'single'],
      semi: ['error', 'always'],
      'no-trailing-spaces': 'warn',
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': [
        'error',
        {
          anonymous: 'always',
          named: 'never',
          asyncArrow: 'always',
        },
      ],
      'no-multiple-empty-lines': ['warn', { max: 2 }],
      'no-empty': 'warn',
      'prefer-arrow-callback': 'warn',
      'arrow-spacing': ['error', { before: true, after: true }],
    },
  },
];
