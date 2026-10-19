// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import TagManager from '@/app/(dashboard)/tag-manager/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/campaigns',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type ApiName = keyof typeof api;
const asMock = (name: ApiName) => vi.mocked(api[name]) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;
const mockOk = (name: ApiName, v: unknown) => asMock(name).mockResolvedValue(v);

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

class FakeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
const lastCall = (name: ApiName): Record<string, unknown> => {
  const calls = asMock(name).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
};
const visits = (n: number, total: number) => ({ data: { total, rows: Array.from({ length: n }, (_, i) => ({
  id: i + 1, contact_name: i === 0 ? 'Ann' : undefined, email: `u${i}@x.com`, utm_campaign: 'oct', utm_source: 'email', utm_medium: i === 0 ? 'newsletter' : undefined,
  destination_url: i === 0 ? 'https://raynatours.com/dubai?x=1' : i === 1 ? 'bad url %%' : undefined, created_at: '2026-10-01T10:00:00Z',
})) } });
const utmSummary = { data: { byCampaign: [{ utm_campaign: 'oct', utm_source: 'email', utm_medium: 'newsletter', total_clicks: 5, unique_visitors: 4, unique_emails: 3 }], bySource: [{ utm_source: 'email' }] } };

describe('Tag manager (GTM) page', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver); });

  it('shows the skeleton while loading', () => {
    asMock('getGTMSnippet').mockReturnValue(new Promise(() => {}));
    render(<TagManager />);
    expect(screen.queryByText('GTM & BigQuery')).toBeNull();
  });

  it('renders top events with typical data and opens the event detail', async () => {
    mockOk('getGTMAnalytics', { data: { daily: [{ day: '2026-10-01', event_count: 3, unique_users: 2 }], top_events: [
      { event_name: 'purchase', count: '1200', unique_users: '300', total_value: '4500.4' },
    ] } });
    mockOk('getGTMEventDetail', { data: [
      { event_id: 1, event_label: 'Safari', event_value: '99.6', page_url: 'https://raynatours.com/p/1', city: 'Dubai', country: 'AE', created_at: '2026-10-01T10:00:00Z' },
      { event_id: 2, page_url: 'not-a-url', created_at: '2026-10-01T10:00:00Z' },
    ] });
    render(<TagManager />);
    await screen.findByText('purchase');
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.getByText('300 unique users')).toBeTruthy();
    expect(screen.getByText('AED 4500')).toBeTruthy();
    fireEvent.click(screen.getByText('purchase'));
    await screen.findByText('Safari');
    expect(api.getGTMEventDetail).toHaveBeenCalledWith('purchase');
    expect(screen.getByText('AED 100')).toBeTruthy();
    expect(screen.getByText('/p/1')).toBeTruthy();
    expect(screen.getByText('not-a-url')).toBeTruthy();
    expect(screen.getByText('Dubai, AE')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    fireEvent.click(screen.getByText('✕ Close'));
    await waitFor(() => expect(screen.queryByText('Safari')).toBeNull());
  });

  it('empty data: shows empty placeholders on every tab', async () => {
    render(<TagManager />);
    await screen.findByText('GTM events will appear here as they are captured.');
    fireEvent.click(screen.getByText('Email Tracking'));
    await screen.findByText('No email visits yet');
    fireEvent.click(screen.getByText('DataLayer Scripts'));
    expect(screen.getByText('Events (0)')).toBeTruthy();
    fireEvent.click(screen.getByText('Special Occasions'));
    fireEvent.click(screen.getByText('GTM Container'));
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API errors are caught and the page still renders', async () => {
    asMock('getGTMSnippet').mockRejectedValue(new Error('HTTP 500'));
    asMock('getEmailUtmLog').mockRejectedValue(new Error('HTTP 500'));
    render(<TagManager />);
    await screen.findByText('GTM & BigQuery');
    expect(console.error).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Email Tracking'));
    await screen.findByText('No email visits yet');
  });

  it('event detail error leaves an empty detail panel', async () => {
    mockOk('getGTMAnalytics', { daily: [], top_events: [{ event_name: 'view', count: '1', unique_users: '1', total_value: '0' }] });
    asMock('getGTMEventDetail').mockRejectedValue(new Error('boom'));
    render(<TagManager />);
    fireEvent.click(await screen.findByText('view'));
    await screen.findByText('No detail rows found.');
  });

  it('email tracking: KPIs, campaign filter, search and pagination call getEmailUtmLog correctly', async () => {
    mockOk('getEmailUtmLog', visits(3, 120));
    mockOk('getEmailUtmSummary', utmSummary);
    render(<TagManager />);
    await screen.findByText('GTM & BigQuery');
    expect(lastCall('getEmailUtmLog')).toEqual({ page: 1, limit: 50 });
    fireEvent.click(screen.getByText('Email Tracking'));
    await screen.findByText('Ann');
    expect(screen.getByText('Showing 1–50 of 120')).toBeTruthy();
    expect(screen.getByText('/dubai')).toBeTruthy();
    expect(screen.getByText('bad url %%')).toBeTruthy();
    fireEvent.click(screen.getByText('Next →'));
    await waitFor(() => expect(lastCall('getEmailUtmLog')).toEqual({ page: 2, limit: 50 }));
    await screen.findByText('Showing 51–100 of 120');
    fireEvent.click(screen.getByRole('button', { name: 'oct' }));
    await waitFor(() => expect(lastCall('getEmailUtmLog')).toEqual({ page: 1, limit: 50, utm_campaign: 'oct' }));
    const input = await screen.findByPlaceholderText('email@example.com');
    fireEvent.change(input, { target: { value: 'ann@x.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lastCall('getEmailUtmLog')).toEqual({ page: 1, limit: 50, email: 'ann@x.com', utm_campaign: 'oct' }));
    fireEvent.click(await screen.findByText('Reset'));
    await waitFor(() => expect(lastCall('getEmailUtmLog')).toEqual({ page: 1, limit: 50 }));
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('datalayer copy, occasions and snippet tabs render their data', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockOk('getDataLayerScripts', { data: { page_view: 'dataLayer.push({event:"pv"})', purchase: 'buy()' } });
    mockOk('getSpecialOccasions', [{ occasion_id: 1, occasion_type: 'festival', name: 'Diwali', is_active: true, start_date: '2026-11-01', end_date: '2026-11-05', discount_code: 'DIW10', coupon_active: true, discount_value: 10, target_markets: '{IN,AE}' }]);
    mockOk('getGTMSnippet', { data: { head: '<script>head</script>', body: '<noscript>body</noscript>' } });
    render(<TagManager />);
    await screen.findByText('GTM & BigQuery');
    fireEvent.click(screen.getByText('DataLayer Scripts'));
    expect(screen.getByText('Events (2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'purchase' }));
    expect(screen.getByText('buy()')).toBeTruthy();
    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('buy()');
    expect(screen.getByText('Copied!')).toBeTruthy();
    fireEvent.click(screen.getByText('Special Occasions'));
    expect(screen.getByText('Diwali')).toBeTruthy();
    expect(screen.getByText('10% off')).toBeTruthy();
    expect(screen.getByText(/IN, AE/)).toBeTruthy();
    fireEvent.click(screen.getByText('GTM Container'));
    expect(screen.getByText('<script>head</script>')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('Export to BigQuery calls getGTMExport', async () => {
    mockOk('getGTMExport', { rows: [{ a: 1 }] });
    render(<TagManager />);
    fireEvent.click(await screen.findByText('Export to BigQuery'));
    await waitFor(() => expect(api.getGTMExport).toHaveBeenCalledTimes(1));
  });

  // BUG app/(dashboard)/tag-manager/page.tsx:243-244 - top event counts go through parseInt with no
  // fallback, so a null/missing count or unique_users from the API renders "NaN" on the KPI card.
  it.fails('never renders NaN for a top event with missing counts', async () => {
    mockOk('getGTMAnalytics', { daily: [], top_events: [{ event_name: 'odd', count: null, unique_users: null, total_value: null }] });
    render(<TagManager />);
    await screen.findByText('odd');
    expect(bodyText()).not.toContain('NaN');
  });
});
