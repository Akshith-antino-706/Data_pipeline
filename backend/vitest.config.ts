import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // setup.js forces local dummy DB/Redis hosts before any app module loads.
    setupFiles: ['tests/setup.ts'],
    // Fail instead of hanging if something tries to open a real connection.
    testTimeout: 10_000,
  },
});
