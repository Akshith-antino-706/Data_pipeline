import { test, expect } from './fixtures/test';

test.describe('journeys', () => {
  test('list shows journeys and opening one shows its flow', async ({ authed: page, api }) => {
    await page.goto('/journeys');
    await expect(page.getByText('Welcome Series').first()).toBeVisible();

    await page.getByText('Welcome Series').first().click();
    await expect(page).toHaveURL(/\/journeys\?id=11$/);
    await expect(page.getByText('Welcome email').first()).toBeVisible();
    expect(api.calls).toContain('GET /api/v3/journeys/11');
  });

  test('deep link ?id= opens the journey directly', async ({ authed: page }) => {
    await page.goto('/journeys?id=11');
    await expect(page.getByText('Welcome email').first()).toBeVisible();
  });
});
