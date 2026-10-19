import { test, expect } from './fixtures/test';

test.describe('send log', () => {
  test('pagination moves between pages', async ({ authed: page, api }) => {
    await page.goto('/log');
    await expect(page.getByText('1–20 of 45')).toBeVisible();
    await expect(page.getByText('1 / 3')).toBeVisible();
    await expect(page.getByText('user1@example.com', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('2 / 3')).toBeVisible();
    await expect(page.getByText('21–40 of 45')).toBeVisible();
    await expect(page.getByText('user21@example.com', { exact: true })).toBeVisible();
    expect(api.calls).toContain('GET /api/v3/test-sends/send-log?page=2&limit=20');

    await page.getByRole('button', { name: '»' }).click();
    await expect(page.getByText('3 / 3')).toBeVisible();
    await expect(page.getByText('41–45 of 45')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  });

  test('status, email and journey filters reach the API and reset to page 1', async ({ authed: page, api }) => {
    await page.goto('/log');
    await expect(page.getByText('1 / 3')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('2 / 3')).toBeVisible();

    await page.getByRole('button', { name: 'Failed', exact: true }).click();
    await expect(page.getByText('1 / 1')).toBeVisible();
    await expect(page.getByText('1–3 of 3')).toBeVisible();
    expect(api.calls.some((c) => c.includes('send-log?') && c.includes('status=failed') && c.includes('page=1'))).toBe(true);

    await page.getByPlaceholder('Search by email…').fill('user2@example.com');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect.poll(() => api.calls.some((c) => c.includes('email=user2%40example.com'))).toBe(true);

    await page.locator('select').filter({ hasText: 'All Journeys' }).selectOption('11');
    await expect.poll(() => api.calls.some((c) => c.includes('journeyId=11'))).toBe(true);

    await page.getByRole('button', { name: /Clear \(\d\)/ }).click();
    await expect(page.getByText('1–20 of 45')).toBeVisible();
  });
});
