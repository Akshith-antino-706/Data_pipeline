import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const shared = {
  languageOptions: {
    ecmaVersion: 2020,
    globals: { ...globals.browser, ...globals.node },
    parserOptions: {
      ecmaVersion: 'latest',
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
}

export default defineConfig([
  globalIgnores(['.next', 'node_modules', 'next-env.d.ts']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    ...shared,
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|^motion$', argsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    ...shared,
    languageOptions: {
      ...shared.languageOptions,
      // Type-aware linting, needed for the no-unsafe-* rules below.
      parserOptions: { ...shared.languageOptions.parserOptions, projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Project rule: real types only — `any` is never allowed in TypeScript files.
      '@typescript-eslint/no-explicit-any': 'error',
      // ...and no IMPLICIT any either (untyped API data, JSON.parse, etc. must be typed).
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|^motion$', argsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'warn',
      // Pre-existing React-hooks issues in the pages (impure Date.now() in render, use-before-
      // declare, etc.). Fixing them changes logic, so they're warnings until fixed separately.
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Existing `cond ? a() : b()` statements; rewriting them is a logic change, not a type change.
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
])
