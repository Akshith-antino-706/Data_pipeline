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
    rules: {
      // Project rule: real types only — `any` is never allowed in TypeScript files.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|^motion$', argsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
