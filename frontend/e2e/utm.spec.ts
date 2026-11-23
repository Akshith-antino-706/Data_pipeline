import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

async function fillBuilder(page: Page, url: string) {
  await page.goto('/utm');
  await page.getByRole('tab', { name: /Link builder/ }).click();
  const form = page.getByRole('tabpanel');
  await form.getByLabel(/Audience/).selectOption('New Leads');
  await form.getByLabel(/Campaign name/).fill('Spring_Sale');
  await form.getByLabel(/Destination page/).fill(url);
}

test.describe('utm builder', () => {
  test('bad URL rejected by the API does not crash the page', async ({ authed: page, api, consoleErrors }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, status: 400, body: { error: 'Invalid URL' } });
    await fillBuilder(page, 'https://rejected.example'); // passes client-side URL validation; the API rejects it
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect.poll(() => api.calls.includes('POST /api/v3/utm/build')).toBe(true);

    await expect(page.getByText('Your link is ready')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(consoleErrors.every((e) => e.includes('Invalid URL'))).toBe(true);
  });

  test('valid URL produces a link', async ({ authed: page, api }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, body: { utm_url: 'https://www.raynatours.com/activities?utm_source=AI_marketer' } });
    await fillBuilder(page, 'https://www.raynatours.com/activities');
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect(page.getByText('Your link is ready')).toBeVisible();
  });

  test('a malformed destination_url in email visits renders without crashing', async ({ authed: page, api, consoleErrors }) => {
    api.use({
      method: 'GET',
      path: /^\/api\/v3\/test-sends\/utm-log\?page=/,
      body: { success: true, data: { total: 1, rows: [{ id: 1, email: 'v@example.com', utm_campaign: 'c1', utm_source: 's', utm_medium: 'email', destination_url: '::not a url::', visited_at: '2026-10-18T10:00:00.000Z', created_at: '2026-10-18T10:00:00.000Z' }] } },
    });
    await page.goto('/utm');
    await expect(page.getByText('::not a url::').first()).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  // The page rejects an invalid destination before calling the API.
  test('invalid landing page URL is rejected client-side', async ({ authed: page, api }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, body: { utm_url: 'not a url?utm_source=AI_marketer' } });
    await fillBuilder(page, 'not a url');
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/v3/utm/build'), { timeout: 5_000 })
      .then(() => true, () => false);
    const create = page.getByRole('button', { name: 'Create link' });
    if (await create.isEnabled()) await create.click();
    expect(await sent, 'build request sent for an invalid URL').toBe(false);
    await expect(page.getByText('Your link is ready')).toHaveCount(0);
  });
});
