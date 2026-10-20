// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import * as api from '@/lib/api';
import type { OverviewWebsite } from '@/lib/api';
import WebsiteOverview, { periodFrom, periodTo, eventLabel, pagePath, shortDate } from '@/app/(dashboard)/utm/WebsiteOverview';

vi.mock('@/lib/api');

const bodyText = (): string => document.body.textContent ?? '';
const off = { available: false, reason: 'unavailable' } as const;

function payload(over: Partial<OverviewWebsite> = {}): OverviewWebsite {
  return {
    range: { from: '2026-10-14', to: '2026-10-20', days: 7 },
    eventsPerDay: { available: true, days: [{ date: '2026-10-19', events: 1500 }, { date: '2026-10-20', events: 25 }] },
    topEvents: { available: true, events: [{ name: 'page_view', count: 1000, uniqueUsers: 300 }] },
    topPages: { available: true, pages: [{ url: 'https://www.raynatours.com/dubai', count: 50 }] },
    lastHour: { available: true, count: 3 },
    utmLinks: { available: true, totals: { links: 10, clickedLinks: 4, clicks: 6, campaigns: 1, uniqueUsers: 3 },
      campaigns: [{ campaignId: 1, name: 'Autumn', segment: null, channel: 'email', links: 10, clickedLinks: 4, clicks: 6, lastClick: null }] },
    ...over,
  };
}

/** A promise we resolve/reject by hand, to hold a request "in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const skeletonsShown = () => screen.queryByTestId('website-loading') !== null;

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Website overview — period picker', () => {
  it('defaults to Last 7 days and uses the 7-day range for the first request', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue(payload());
    render(<WebsiteOverview />);
    expect(api.getOverviewWebsite).toHaveBeenCalledTimes(1);
    expect(api.getOverviewWebsite).toHaveBeenNthCalledWith(1, periodFrom(7), periodTo());
    expect(screen.getByRole('group', { name: 'Period' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('combobox')).toBeNull();
    await screen.findByText('1,525');
    expect(screen.getByText('14 Oct – 20 Oct 2026')).toBeTruthy();
  });

  it('periodFrom/periodTo give an inclusive Dubai-date range', () => {
    const now = new Date('2026-10-20T22:30:00Z'); // already 21 Oct in Dubai
    expect(periodTo(now)).toBe('2026-10-21');
    expect(periodFrom(7, now)).toBe('2026-10-15');
    expect(periodFrom(90, now)).toBe('2026-07-24');
  });
});

describe('Website overview — loading states', () => {
  it('shows skeletons for every part on first load', () => {
    vi.mocked(api.getOverviewWebsite).mockReturnValue(new Promise<OverviewWebsite>(() => {}));
    render(<WebsiteOverview />);
    expect(skeletonsShown()).toBe(true);
    expect(screen.getAllByTestId('website-skeleton-panel').length).toBe(3);
    expect(screen.queryByTestId('website-skeleton-campaigns')).toBeNull();
    expect(bodyText()).not.toContain('Not available right now');
    expect(bodyText()).not.toMatch(/No .* in this period/);
  });

  it('shows skeletons (not old data or empty states) while a period change is pending', async () => {
    const pending = deferred<OverviewWebsite>();
    vi.mocked(api.getOverviewWebsite).mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise);
    render(<WebsiteOverview />);
    await screen.findByText('1,525');
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(skeletonsShown()).toBe(true));
    expect(screen.queryByText('1,525')).toBeNull();
    expect(screen.getAllByTestId('website-skeleton-panel').length).toBe(3);
    expect(screen.queryByTestId('website-skeleton-campaigns')).toBeNull();
    expect(api.getOverviewWebsite).toHaveBeenLastCalledWith(periodFrom(90), periodTo());
    await act(async () => { pending.resolve(payload({ eventsPerDay: { available: true, days: [{ date: '2026-08-01', events: 9000 }] } })); });
    await screen.findByText('9,000');
    expect(skeletonsShown()).toBe(false);
  });

  it('clears the old error and shows skeletons while Try again is running', async () => {
    const pending = deferred<OverviewWebsite>();
    vi.mocked(api.getOverviewWebsite).mockRejectedValueOnce(new Error('HTTP 500')).mockReturnValueOnce(pending.promise);
    render(<WebsiteOverview />);
    await screen.findByText("Couldn't load website activity");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(skeletonsShown()).toBe(true));
    expect(screen.queryByText("Couldn't load website activity")).toBeNull();
    await act(async () => { pending.resolve(payload()); });
    await screen.findByText('1,525');
  });

  it('a section-level Try again reloads with skeletons', async () => {
    const pending = deferred<OverviewWebsite>();
    vi.mocked(api.getOverviewWebsite).mockResolvedValueOnce(payload({ topPages: off })).mockReturnValueOnce(pending.promise);
    render(<WebsiteOverview />);
    await screen.findByText('Not available right now');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(skeletonsShown()).toBe(true));
    expect(screen.queryByText('Not available right now')).toBeNull();
    await act(async () => { pending.resolve(payload()); });
    await screen.findByText('/dubai');
  });

  it('shows "Still working on it…" after 8 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getOverviewWebsite).mockReturnValue(new Promise<OverviewWebsite>(() => {}));
    render(<WebsiteOverview />);
    expect(screen.queryByText(/Still working on it/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText(/Still working on it…/)).toBeTruthy();
  });
});

describe('Website overview — resilience', () => {
  it('retries once quietly on a dropped connection (TypeError)', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getOverviewWebsite).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(payload());
    render(<WebsiteOverview />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.getOverviewWebsite).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1,525')).toBeTruthy();
    expect(screen.queryByText("Couldn't load website activity")).toBeNull();
  });

  it('shows the error if the quiet retry also fails', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getOverviewWebsite).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<WebsiteOverview />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.getOverviewWebsite).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't load website activity")).toBeTruthy();
  });

  it('does not retry on an HTTP error', async () => {
    vi.mocked(api.getOverviewWebsite).mockRejectedValue(new Error('HTTP 502'));
    render(<WebsiteOverview />);
    await screen.findByText("Couldn't load website activity");
    expect(api.getOverviewWebsite).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale response from an older period', async () => {
    const first = deferred<OverviewWebsite>();
    const second = deferred<OverviewWebsite>();
    vi.mocked(api.getOverviewWebsite).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<WebsiteOverview />);
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await act(async () => { second.resolve(payload({ lastHour: { available: true, count: 222 } })); });
    await screen.findByText('222');
    await act(async () => { first.resolve(payload({ lastHour: { available: true, count: 111 } })); });
    expect(screen.queryByText('111')).toBeNull();
    expect(screen.getByText('222')).toBeTruthy();
  });

  it('missing sections show "—", never NaN or undefined', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue({ range: payload().range, lastHour: { available: true, count: 5 } } as OverviewWebsite);
    render(<WebsiteOverview />);
    await screen.findByText('5');
    expect(screen.getAllByText('—').length).toBe(3);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });
});

describe('Website overview — lists', () => {
  it('shows at most 8 items with a Show all toggle, and full URLs as tooltips', async () => {
    const pages = Array.from({ length: 11 }, (_, i) => ({ url: `https://www.raynatours.com/p/${i}`, count: 100 - i }));
    vi.mocked(api.getOverviewWebsite).mockResolvedValue(payload({ topPages: { available: true, pages } }));
    render(<WebsiteOverview />);
    const list = await screen.findByRole('list', { name: 'Most visited pages' });
    expect(list.querySelectorAll('li').length).toBe(8);
    expect(list.querySelector('li')?.getAttribute('title')).toContain('https://www.raynatours.com/p/0');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 11' }));
    expect(screen.getByRole('list', { name: 'Most visited pages' }).querySelectorAll('li').length).toBe(11);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getByRole('list', { name: 'Most visited pages' }).querySelectorAll('li').length).toBe(8);
  });

  it('does not show a campaign links preview (removed at the user\'s request)', async () => {
    vi.mocked(api.getOverviewWebsite).mockResolvedValue(payload());
    render(<WebsiteOverview />);
    await screen.findByTestId('kpi-links');
    expect(screen.queryByRole('region', { name: 'Campaign links' })).toBeNull();
    expect(screen.queryByText('See all in Campaign links')).toBeNull();
  });

  it('maps common event names to plain English and humanises the rest', () => {
    expect(eventLabel('page_view')).toBe('Viewed a page');
    expect(eventLabel('view_item')).toBe('Viewed a product');
    expect(eventLabel('add_to_cart')).toBe('Added to cart');
    expect(eventLabel('begin_checkout')).toBe('Started checkout');
    expect(eventLabel('purchase')).toBe('Booked');
    expect(eventLabel('tour_option_selected')).toBe('Tour option selected');
    expect(eventLabel('videoPlayStarted')).toBe('Video play started');
    expect(eventLabel('')).toBe('Unnamed event');
  });

  it('formats paths and dates without raw ISO strings', () => {
    expect(pagePath('https://x.com/a/b?c=1')).toBe('/a/b?c=1');
    expect(pagePath('not a url')).toBe('not a url');
    expect(shortDate('2026-10-14')).toBe('14 Oct');
    expect(shortDate('2026-10-20', { year: true })).toBe('20 Oct 2026');
    expect(shortDate('garbage')).toBe('');
  });
});
