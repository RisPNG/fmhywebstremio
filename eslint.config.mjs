import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  tseslint.configs.recommended,
  {
    ignores: ['./dist', './blueprint', './references'],
  },
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': false }],
      '@typescript-eslint/no-array-constructor': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      'import/no-unresolved': ['error', { ignore: ['typescript-eslint', 'stremio-addon-sdk'] }],
    },
  },
);
