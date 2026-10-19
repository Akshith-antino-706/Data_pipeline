import { test, expect } from './fixtures/test';

test.describe('segmentation create-segment modal', () => {
  test('Create stays disabled until a name and a valid condition exist', async ({ authed: page, api }) => {
    await page.goto('/segmentation');
    await page.getByRole('button', { name: 'Create Segment' }).click();
    await expect(page.getByText('Create Custom Segment')).toBeVisible();

    const create = page.getByRole('button', { name: 'Create Segment' }).last();
    await expect(create).toBeDisabled();

    // Name only → still invalid (no conditions)
    const name = page.getByPlaceholder('e.g. High-Value Local Travelers');
    await name.fill('UAE travellers');
    await expect(create).toBeDisabled();

    // Condition type picked but no field → still invalid
    await page.getByRole('button', { name: /Contact Property/ }).click();
    await expect(create).toBeDisabled();
    await page.locator('select').filter({ hasText: 'Select a property...' }).selectOption('country');
    await expect(create).toBeDisabled(); // empty value

    await page.getByPlaceholder('e.g. INDIA, UAE').fill('UAE');
    await expect(create).toBeEnabled();
    await expect(page.getByText('42', { exact: true })).toBeVisible(); // preview-count fixture

    // Whitespace-only name invalidates again
    await name.fill('   ');
    await expect(create).toBeDisabled();
    await name.fill('UAE travellers');

    const postReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/v3/custom-segments'));
    await create.click();
    const body = JSON.parse((await postReq).postData() || '{}') as { name?: string; conditions?: { field?: string; value?: unknown }[] };
    expect(body.name).toBe('UAE travellers');
    expect(body.conditions?.[0]?.field).toBe('country');
    expect(body.conditions?.[0]?.value).toBe('UAE');
    await expect(page.getByText('Create Custom Segment')).toHaveCount(0);
    expect(api.unmocked).toEqual([]);
  });

  test('Cancel closes the modal without saving', async ({ authed: page, api }) => {
    await page.goto('/segmentation');
    await page.getByRole('button', { name: 'Create Segment' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Create Custom Segment')).toHaveCount(0);
    expect(api.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });
});
