import { test, expect } from './fixtures/test';

test.describe('API 500 handling', () => {
  test('contacts list 500 shows an error toast, not a crash', async ({ authed: page, api }) => {
    api.use({ method: 'GET', path: /^\/api\/v3\/unified-contacts\?/, status: 500, body: { success: false, error: 'Database unavailable' } });
    await page.goto('/contacts');
    await expect(page.getByText('Database unavailable')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toBeVisible();
  });

  test('journey dashboard 500 shows an error state with a working Retry', async ({ authed: page, api }) => {
    api.use({ method: 'GET', path: /^\/api\/v3\/journeys\/dashboard$/, status: 500, body: { success: false, error: 'Internal Server Error' } });
    await page.goto('/journeys/dashboard');
    await expect(page.getByText('Internal Server Error')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // Backend recovers → Retry loads the dashboard.
    api.use({ method: 'GET', path: /^\/api\/v3\/journeys\/dashboard$/, body: { success: true, data: { kpis: { activeJourneys: 7, openRate7d: 10 } } } });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Journey monitor' })).toBeVisible();
    await expect(page.getByText('Internal Server Error')).toHaveCount(0);
  });

  test('500 with an HTML body (proxy error page) is handled', async ({ authed: page, api }) => {
    api.use({ method: 'GET', path: /^\/api\/v3\/unified-contacts\?/, status: 502, body: '<html>Bad Gateway</html>' });
    await page.goto('/contacts');
    await expect(page.getByRole('status').filter({ hasText: /\S/ })).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toBeVisible();
  });

  // BUG: app/(dashboard)/affinity/page.tsx stores the customers response as-is (setList(d)) and
  // then reads list.customers.length, so a body without `customers` (e.g. {} or { total: 0 })
  // throws a TypeError and the page falls into the error boundary instead of the empty state.
  test('affinity survives a customers response without a customers array', async ({ authed: page, api }) => {
    api.use({ method: 'GET', path: /^\/api\/v3\/booking-affinity\/customers\?/, body: { total: 0 } });
    await page.goto('/affinity');
    await expect(page.getByText(/No customers booked/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });

  // BUG: the service filter cards on app/(dashboard)/affinity/page.tsx (~line 437) look the
  // service up in the hard-coded SERVICES map with no fallback, so any service key the backend
  // adds later (e.g. "cruises") throws "Cannot read properties of undefined (reading 'color')"
  // and takes down the whole page. ServiceBadge in the same file already has a fallback.
  test('affinity survives an unknown service key in the summary', async ({ authed: page, api }) => {
    api.use({ method: 'GET', path: /^\/api\/v3\/booking-affinity\/summary\?/, body: { status: 'ready', builtAt: '2026-10-19T00:30:00.000Z', totalCustomers: 1, topService: [{ service: 'cruises', customers: 1 }] } });
    await page.goto('/affinity');
    await expect(page.getByText('Aisha Khan')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});
