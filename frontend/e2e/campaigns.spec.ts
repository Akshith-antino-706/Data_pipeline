import { test, expect, expectNoBadText } from './fixtures/test';

test.describe('campaign detail', () => {
  test('shows journey-level send stats from campaign analytics', async ({ authed: page, consoleErrors }) => {
    await page.goto('/campaigns');
    await page.getByRole('row', { name: /Welcome Series/ }).click();
    await expect(page).toHaveURL(/\/campaigns\/11$/);

    for (const [label, value] of [['TARGET', '320'], ['SENT', '300'], ['OPENED', '150'], ['CLICKED', '40']] as const) {
      const labelEl = page.getByText(label, { exact: true }).first();
      await expect(labelEl).toBeVisible();
      await expect(labelEl.locator('xpath=preceding-sibling::div[1]')).toHaveText(value);
    }
    await expectNoBadText(page);
    expect(consoleErrors).toEqual([]);
  });
});
