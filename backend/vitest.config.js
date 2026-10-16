import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // setup.js forces local dummy DB/Redis hosts before any app module loads.
    setupFiles: ['tests/setup.js'],
    // Fail instead of hanging if something tries to open a real connection.
    testTimeout: 10_000,
  },
});
