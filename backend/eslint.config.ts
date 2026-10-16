import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// Lints the TypeScript files. JavaScript files are converted to TypeScript folder by folder;
// they are left out until then so this config never blocks on pre-existing JS issues.
export default defineConfig([
  globalIgnores(['node_modules', 'src/migrations', '**/*.js', '**/*.mjs', '**/*.cjs']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
      // Type-aware linting, needed for the no-unsafe-* rules below.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Project rule: real types only — `any` is never allowed in TypeScript files.
      '@typescript-eslint/no-explicit-any': 'error',
      // ...and no IMPLICIT any either: untyped pg rows, JSON.parse, res.json() etc. must be typed.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Existing code uses empty `catch {}` to deliberately swallow best-effort errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Style rules on pre-existing code, kept as warnings so CI only fails on real type problems.
      // Fixing them can subtly change regex behaviour, so they're cleaned up separately.
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-misleading-character-class': 'warn',
      // Existing `cond ? a() : b()` statements; rewriting them is a logic change, not a type change.
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
]);
