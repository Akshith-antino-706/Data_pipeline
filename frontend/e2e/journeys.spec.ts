import { test, expect } from './fixtures/test';

test.describe('journeys', () => {
  test('list shows journeys and opening one shows its flow', async ({ authed: page, api }) => {
    await page.goto('/journeys');
    await expect(page.getByText('Welcome Series').first()).toBeVisible();

    await page.getByText('Welcome Series').first().click();
    await expect(page).toHaveURL(/\/journeys\/11$/);
    await expect(page.getByText('Welcome email').first()).toBeVisible();
    expect(api.calls).toContain('GET /api/v3/journeys/11');

    // Browser back returns to the list, forward reopens the journey.
    await page.goBack();
    await expect(page).toHaveURL(/\/journeys$/);
    await expect(page.getByText('Welcome Series').first()).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/journeys\/11$/);
    await expect(page.getByText('Welcome email').first()).toBeVisible();
  });

  test('deep link /journeys/11 opens the journey directly', async ({ authed: page }) => {
    await page.goto('/journeys/11');
    await expect(page.getByText('Welcome email').first()).toBeVisible();
    await page.getByRole('button', { name: /All journeys/ }).click();
    await expect(page).toHaveURL(/\/journeys$/);
  });

  test('old ?id= links redirect to /journeys/<id>', async ({ authed: page }) => {
    await page.goto('/journeys?id=11');
    await expect(page).toHaveURL(/\/journeys\/11$/);
    await expect(page.getByText('Welcome email').first()).toBeVisible();
  });

  test('the chosen tab and filters survive a refresh and a round trip to a journey', async ({ authed: page }) => {
    await page.goto('/journeys');
    await expect(page.getByRole('tab', { name: /Running/ })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: /Drafts/ }).click();
    await page.getByLabel('Sort').selectOption('name');
    await expect(page).toHaveURL(/\/journeys\?status=draft&sort=name$/);

    await page.reload();
    await expect(page.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Sort')).toHaveValue('name');

    // Open a journey and come back with the in-app button: same tab and sort.
    await page.getByText('Welcome Series').first().click();
    await expect(page).toHaveURL(/\/journeys\/11$/);
    await page.getByRole('button', { name: /All journeys/ }).click();
    await expect(page).toHaveURL(/\/journeys\?status=draft&sort=name$/);
    await expect(page.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true');

    // Back to the default tab drops the param again.
    await page.getByRole('tab', { name: /Running/ }).click();
    await expect(page).toHaveURL(/\/journeys\?sort=name$/);
  });

  test('an unknown ?status= falls back to Running', async ({ authed: page }) => {
    await page.goto('/journeys?status=bogus');
    await expect(page.getByRole('tab', { name: /Running/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('Create journey opens the wizard on /journeys/new', async ({ authed: page, api }) => {
    await page.goto('/journeys');
    await page.getByRole('link', { name: 'Create journey' }).first().click();
    await expect(page).toHaveURL(/\/journeys\/new$/);
    await expect(page.getByRole('heading', { name: 'What is this journey for?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Basics/ })).toHaveAttribute('aria-current', 'step');
    expect(api.calls.filter(c => c.startsWith('POST'))).toEqual([]);
  });
});
