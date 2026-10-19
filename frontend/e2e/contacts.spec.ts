import { test, expect } from './fixtures/test';

test.describe('contacts', () => {
  test('search filters the table and sends the query to the API', async ({ authed: page, api }) => {
    await page.goto('/contacts');
    const table = page.locator('table');
    await expect(table.getByText('Aisha Khan')).toBeVisible();
    await expect(table.getByText('Rahul Mehta')).toBeVisible();

    const search = page.getByPlaceholder('Search by name, email, phone or company...');
    await search.fill('rahul');
    await search.press('Enter');

    await expect(table.getByText('Rahul Mehta')).toBeVisible();
    await expect(table.getByText('Aisha Khan')).toHaveCount(0);
    expect(api.calls.some((c) => c.startsWith('GET /api/v3/unified-contacts?') && c.includes('search=rahul'))).toBe(true);

    await search.fill('zzz-nobody');
    await search.press('Enter');
    await expect(page.getByText('No contacts found for "zzz-nobody".')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).first().click();
    await expect(table.getByText('Aisha Khan')).toBeVisible();
  });
});
