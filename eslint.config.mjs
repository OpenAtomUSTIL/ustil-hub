import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/migrations/**',
      'coverage/**',
      // 第三方 vendored 源码（Platane/snk，见 snake/vendor/NOTICE.txt），不套本仓 lint 规则
      'src/modules/users/snake/vendor/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
