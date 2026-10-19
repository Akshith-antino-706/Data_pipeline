import { test, expect, expectNoBadText } from './fixtures/test';

// Every sidebar entry (see NAV_GROUPS in app/(dashboard)/layout.tsx), labelled as in the grouped sidebar.
const PAGES: { label: string; href: string }[] = [
  { label: 'Home', href: '/dashboard' },
  { label: 'Contacts', href: '/contacts' },
  { label: 'Segments', href: '/segmentation' },
  { label: 'Segment changes', href: '/segment-activity' },
  { label: 'Booking interests', href: '/affinity' },
  { label: 'Leads', href: '/leads' },
  { label: 'Journeys', href: '/journeys' },
  { label: 'Sends', href: '/test-sends' },
  { label: 'Templates', href: '/content' },
  { label: 'Performance', href: '/journeys/analytics' },
  { label: 'Campaign results', href: '/campaigns' },
  { label: 'Website & links', href: '/utm' },
  { label: 'GTM & BigQuery', href: '/tag-manager' },
  { label: 'Reports', href: '/daily-report' },
  { label: 'Status center', href: '/data-pipeline' },
  { label: 'Journey monitor', href: '/journeys/dashboard' },
  { label: 'Message log', href: '/log' },
  { label: 'System docs', href: '/system' },
];

test.describe('sidebar navigation', () => {
  for (const { label, href } of PAGES) {
    test(`${label} (${href}) loads cleanly`, async ({ authed: page, consoleErrors }) => {
      await page.goto('/dashboard');
      const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });
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
