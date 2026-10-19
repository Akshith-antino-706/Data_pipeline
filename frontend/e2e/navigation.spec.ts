import { test, expect, expectNoBadText } from './fixtures/test';

// Every sidebar entry (see app/(dashboard)/layout.tsx NAV) with a heading-ish text to wait for.
const PAGES: { label: string; href: string }[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Segmentation', href: '/segmentation' },
  { label: 'Segment Activity', href: '/segment-activity' },
  { label: 'Contacts', href: '/contacts' },
  { label: 'Affinity', href: '/affinity' },
  { label: 'Journeys', href: '/journeys' },
  { label: 'Journey Dashboard', href: '/journeys/dashboard' },
  { label: 'Journey Analytics', href: '/journeys/analytics' },
  { label: 'Campaigns', href: '/campaigns' },
  { label: 'Content', href: '/content' },
  { label: 'Send Log', href: '/log' },
  { label: 'UTM Tracking', href: '/utm' },
  { label: 'GTM & BigQuery', href: '/tag-manager' },
  { label: 'Data Pipeline', href: '/data-pipeline' },
  { label: 'Daily Report', href: '/daily-report' },
  { label: 'Leads', href: '/leads' },
  { label: 'System Docs', href: '/system' },
];

test.describe('sidebar navigation', () => {
  for (const { label, href } of PAGES) {
    test(`${label} (${href}) loads cleanly`, async ({ authed: page, consoleErrors }) => {
      await page.goto('/dashboard');
      const link = page.locator(`aside a[href="${href}"]`).first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, '\\/')}(\\?.*)?$`));
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.spinner')).toHaveCount(0);
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
      await expectNoBadText(page);
      expect(consoleErrors).toEqual([]);
    });
  }
});
