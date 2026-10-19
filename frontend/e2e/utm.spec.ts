import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

async function fillBuilder(page: Page, url: string) {
  await page.goto('/utm');
  await page.getByRole('button', { name: /UTM Builder/ }).click();
  await page.locator('select').filter({ hasText: 'Select segment...' }).selectOption('New Leads');
  await page.getByPlaceholder('e.g. Spring_Sale_Email').fill('Spring_Sale');
  const urlInput = page.locator('.form-group', { hasText: 'Landing Page URL' }).locator('input');
  await urlInput.fill(url);
}

test.describe('utm builder', () => {
  test('bad URL rejected by the API does not crash the page', async ({ authed: page, api, consoleErrors }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, status: 400, body: { error: 'Invalid URL' } });
    await fillBuilder(page, 'https://rejected.example'); // passes client-side URL validation; the API rejects it
    await page.getByRole('button', { name: 'Generate UTM Link' }).click();
    await expect.poll(() => api.calls.includes('POST /api/v3/utm/build')).toBe(true);

    await expect(page.getByText('Fill in the form and click Generate')).toBeVisible();
    await expect(page.getByText('Generated UTM Link')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(consoleErrors.every((e) => e.includes('Invalid URL'))).toBe(true);
  });

  test('valid URL produces a link', async ({ authed: page, api }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, body: { utm_url: 'https://www.raynatours.com/activities?utm_source=AI_marketer' } });
    await fillBuilder(page, 'https://www.raynatours.com/activities');
    await page.getByRole('button', { name: 'Generate UTM Link' }).click();
    await expect(page.getByText('https://www.raynatours.com/activities?utm_source=AI_marketer').first()).toBeVisible();
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

  // BUG: the builder sends any string as the landing page URL. Neither the page nor
  // POST /api/v3/utm/build (UTMService.buildUTM just concatenates `${base}?${params}`)
  // validates it, so "not a url" yields a junk "not a url?utm_source=..." link and there is
  // no user-visible error. Expected: the page rejects an invalid URL before calling the API.
  test('invalid landing page URL is rejected client-side', async ({ authed: page, api }) => {
    api.use({ method: 'POST', path: /^\/api\/v3\/utm\/build$/, body: { utm_url: 'not a url?utm_source=AI_marketer' } });
    await fillBuilder(page, 'not a url');
    const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/v3/utm/build'), { timeout: 5_000 })
      .then(() => true, () => false);
    await page.getByRole('button', { name: 'Generate UTM Link' }).click();
    expect(await sent, 'build request sent for an invalid URL').toBe(false);
    await expect(page.getByText('Generated UTM Link')).toHaveCount(0);
  });
});
