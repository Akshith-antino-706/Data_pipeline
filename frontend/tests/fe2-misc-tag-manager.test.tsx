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

describe('Tag manager (GTM) page', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver); });

  it('shows the skeleton while the analytics load, and loads only the analytics on open', () => {
    asMock('getGTMAnalytics').mockReturnValue(new Promise(() => {}));
    render(<TagManager />);
    expect(screen.queryByText('GTM & BigQuery')).toBeNull();
    for (const fn of ['getGTMSnippet', 'getDataLayerScripts', 'getSpecialOccasions', 'getGTMEventDetail'] as const) {
      expect(api[fn]).not.toHaveBeenCalled();
    }
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

  it('empty data: shows empty placeholders on every tab, each loaded when first opened', async () => {
    render(<TagManager />);
    await screen.findByText('GTM events will appear here as they are captured.');
    expect(screen.queryByText('Email Tracking')).toBeNull();
    expect(screen.getByRole('link', { name: 'Email visits' }).getAttribute('href')).toBe('/utm?tab=visits');
    expect(api.getDataLayerScripts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('DataLayer Scripts'));
    await screen.findByText('Events (0)');
    expect(api.getDataLayerScripts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Special Occasions'));
    await screen.findByText('No special occasions');
    fireEvent.click(screen.getByText('GTM Container'));
    await waitFor(() => expect(api.getGTMSnippet).toHaveBeenCalledTimes(1));
    // going back does not reload
    fireEvent.click(screen.getByText('DataLayer Scripts'));
    expect(screen.getByText('Events (0)')).toBeTruthy();
    expect(api.getDataLayerScripts).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API errors are caught: the page still renders and each tab shows its own error with Try again', async () => {
    asMock('getGTMAnalytics').mockRejectedValue(new Error('HTTP 500'));
    asMock('getGTMSnippet').mockRejectedValue(new Error('HTTP 503'));
    render(<TagManager />);
    await screen.findByText('GTM & BigQuery');
    expect(console.error).toHaveBeenCalled();
    await screen.findByText("Couldn't load event analytics");
    fireEvent.click(screen.getByText('GTM Container'));
    await screen.findByText("Couldn't load the GTM container snippet");
    mockOk('getGTMSnippet', { data: { head: '<script>ok</script>', body: '' } });
    fireEvent.click(screen.getByText('Try again'));
    await screen.findByText('<script>ok</script>');
  });

  it('event detail error leaves an empty detail panel', async () => {
    mockOk('getGTMAnalytics', { daily: [], top_events: [{ event_name: 'view', count: '1', unique_users: '1', total_value: '0' }] });
    asMock('getGTMEventDetail').mockRejectedValue(new Error('boom'));
    render(<TagManager />);
    fireEvent.click(await screen.findByText('view'));
    await screen.findByText('No detail rows found.');
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
    await screen.findByText('Events (2)');
    fireEvent.click(screen.getByRole('button', { name: 'purchase' }));
    expect(screen.getByText('buy()')).toBeTruthy();
    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('buy()');
    expect(screen.getByText('Copied!')).toBeTruthy();
    fireEvent.click(screen.getByText('Special Occasions'));
    await screen.findByText('Diwali');
    expect(screen.getByText('10% off')).toBeTruthy();
    expect(screen.getByText(/IN, AE/)).toBeTruthy();
    fireEvent.click(screen.getByText('GTM Container'));
    await screen.findByText('<script>head</script>');
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
  it('never renders NaN for a top event with missing counts', async () => {
    mockOk('getGTMAnalytics', { daily: [], top_events: [{ event_name: 'odd', count: null, unique_users: null, total_value: null }] });
    render(<TagManager />);
    await screen.findByText('odd');
    expect(bodyText()).not.toContain('NaN');
  });
});
