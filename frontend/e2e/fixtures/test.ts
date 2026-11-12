import { test as base, expect, type Page, type Route } from '@playwright/test';
import { API_ORIGIN, APP_PORT } from './constants';
import { defaultMocks, type Json, type Mock } from './mocks';

export { expect };

export interface ApiMocker {
  /** Add mocks that take priority over the defaults (last added wins). */
  use: (...mocks: Mock[]) => void;
  /** Every API request the page made, as "METHOD /path?query". */
  calls: string[];
  /** API requests that no mock matched (the test fails if this is non-empty). */
  unmocked: string[];
}

interface Fixtures {
  api: ApiMocker;
  consoleErrors: string[];
  /** Pre-authenticated page (token in localStorage + auth cookie). */
  authed: Page;
}

export const FAKE_AUTH = {
  token: 'e2e-fake-token',
  refreshToken: 'e2e-fake-refresh',
  user: { id: 1, email: 'e2e@example.com', name: 'E2E User', role: 'admin' },
};

const APP_HOSTS = new Set([`localhost:${APP_PORT}`, `127.0.0.1:${APP_PORT}`]);

// Errors the browser logs on its own for requests we deliberately abort (fonts, CDNs) or
// for deliberate 4xx/5xx fixtures. They are not application errors.
const BENIGN_CONSOLE = [
  /Failed to load resource/i,
  /net::ERR_FAILED/i,
  /Download the React DevTools/i,
];

function findMock(mocks: Mock[], method: string, pathWithQuery: string): Mock | undefined {
  for (let i = mocks.length - 1; i >= 0; i--) {
    const m = mocks[i];
    if (m.method && m.method !== method) continue;
    if (m.path.test(pathWithQuery)) return m;
  }
  return undefined;
}

async function fulfil(route: Route, status: number, body: Json): Promise<void> {
  // The app origin, echoed back so credentialed fetches pass CORS too.
  const origin = (await route.request().headerValue('origin')) || `http://localhost:${APP_PORT}`;
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
    body: JSON.stringify(body),
  });
}

export const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const mocks: Mock[] = [...defaultMocks];
    const api: ApiMocker = { use: (...m) => { mocks.push(...m); }, calls: [], unmocked: [] };

    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === API_ORIGIN) {
        const method = req.method();
        if (method === 'OPTIONS') return fulfil(route, 204, null);
        const key = `${method} ${url.pathname}${url.search}`;
        api.calls.push(key);
        const mock = findMock(mocks, method, `${url.pathname}${url.search}`);
        if (!mock) {
          api.unmocked.push(key);
          return fulfil(route, 404, { success: false, error: `E2E: unmocked ${key}` });
        }
        const body = typeof mock.body === 'function' ? mock.body(url, req.postData()) : mock.body;
        return fulfil(route, mock.status ?? 200, body);
      }
      // Only the Next dev server on this machine may be reached. Everything else
      // (fonts, CDNs, analytics, any real backend) is aborted.
      if ((url.protocol === 'http:' || url.protocol === 'ws:') && APP_HOSTS.has(url.host)) return route.continue();
      if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      return route.abort('blockedbyclient');
    });

    await provide(api);
    expect(api.unmocked, 'API requests without a fixture').toEqual([]);
  },

  consoleErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (BENIGN_CONSOLE.some((r) => r.test(text))) return;
      errors.push(text);
    });
    page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message}`); });
    await provide(errors);
  },

  authed: async ({ page, context, api }, provide) => {
    void api; // ensure routing is installed before any navigation
    await context.addCookies([{ name: 'rayna-auth', value: '1', domain: 'localhost', path: '/' }]);
    await page.addInitScript((auth) => {
      localStorage.setItem('rayna-auth', auth);
      localStorage.setItem('rayna-last-activity', String(Date.now()));
    }, JSON.stringify(FAKE_AUTH));
    await provide(page);
  },
});

/** Visible page text must never show NaN / undefined / null rendering artefacts. */
export async function expectNoBadText(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, 'page shows "NaN"').not.toMatch(/\bNaN\b/);
  expect(text, 'page shows "undefined"').not.toMatch(/\bundefined\b/);
}
