import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Lints the TypeScript files. JavaScript files are converted to TypeScript folder by folder;
// they are left out until then so this config never blocks on pre-existing JS issues.
export default defineConfig([
  globalIgnores(['node_modules', 'src/migrations', 'scripts', '**/*.js', '**/*.mjs']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Project rule: real types only — `any` is never allowed in TypeScript files.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Existing code uses empty `catch {}` to deliberately swallow best-effort errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]);
