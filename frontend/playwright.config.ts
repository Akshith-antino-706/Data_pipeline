import { defineConfig, devices } from '@playwright/test';

// The frontend is pointed at an unroutable API origin. Every request to it is answered by
// page.route fixtures (see e2e/fixtures/test.ts) — the real backend and database are never hit.
import { API_ORIGIN } from './e2e/fixtures/constants';
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Runs `next dev -p 5199` from a scratch copy so frontend/.next is never written.
    command: 'bash e2e/prepare-copy.sh',
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEXT_PUBLIC_API_URL: API_ORIGIN, NEXT_TELEMETRY_DISABLED: '1' },
  },
});
