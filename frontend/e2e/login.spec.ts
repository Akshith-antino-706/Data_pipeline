import { test, expect, FAKE_AUTH } from './fixtures/test';
import type { Json } from './fixtures/mocks';

test.describe('login', () => {
  test.beforeEach(async ({ api }) => {
    api.use({
      method: 'POST',
      path: /^\/api\/auth\/login$/,
      body: (_url, postData): Json => {
        const { password } = JSON.parse(postData || '{}') as { password?: string };
        return password === 'correct-horse'
          ? { success: true, data: FAKE_AUTH }
          : { success: false, error: 'Invalid email or password' };
      },
    });
  });

  test('success signs in and lands on the dashboard', async ({ page, api }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('e2e@example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct-horse');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('aside a[href="/contacts"]')).toBeVisible();
    expect(api.calls).toContain('POST /api/auth/login');
    const stored = await page.evaluate(() => localStorage.getItem('rayna-auth'));
    expect(stored).toContain(FAKE_AUTH.token);
  });

  test('wrong password shows the error and stays on /login', async ({ page, api }) => {
    // The mock answers 200 with success:false; also cover a real 401 response.
    api.use({ method: 'POST', path: /^\/api\/auth\/login$/, status: 401, body: { success: false, error: 'Invalid email or password' } });
    await page.goto('/login');
    await page.getByLabel('Email').fill('e2e@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('rayna-auth'))).toBeNull();
  });

  test('empty form is rejected without calling the API', async ({ page, api }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Please enter both email and password')).toBeVisible();
    expect(api.calls).toEqual([]);
  });

  test('protected page redirects to /login when signed out, remembering the page', async ({ page, api }) => {
    void api;
    await page.goto('/contacts');
    await expect(page).toHaveURL(/\/login\?next=%2Fcontacts$/);
  });

  test('signing in from a deep link lands back on that page, query included', async ({ page }) => {
    await page.goto('/journeys/11?tab=flow');
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email').fill('e2e@example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct-horse');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/journeys\/11\?tab=flow$/);
    await expect(page.getByText('Welcome Series')).toBeVisible();
  });

  test('a ?next= pointing off-site is ignored — the dashboard is used instead', async ({ page }) => {
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2Fphish');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
    await page.getByLabel('Email').fill('e2e@example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct-horse');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
