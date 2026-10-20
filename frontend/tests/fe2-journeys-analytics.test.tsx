// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import JourneyAnalyticsPage from '@/app/(dashboard)/journeys/analytics/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/journeys/analytics',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const fetchStub = vi.fn<() => Promise<Response>>(() => Promise.reject(new Error('network disabled')));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

const ROWS = [
  { journey_id: 1, journey_name: 'Welcome Series', journey_status: 'active', journey_type: 'fixed', entries: 100, sent: 90, delivered: 80, failed: 2, opened: 40, human_opened: 30, clicked: 10, human_clicked: 8, landed: 3, bounced: 1, unsubscribed: 4, gtm_events: 5, booked: 1, bot_window_sec: 20 },
  { journey_id: 2, journey_name: 'Cart Abandon', journey_status: 'paused', journey_type: 'gtm', entries: 500, sent: 0, delivered: 0, opened: 0, clicked: 0, landed: 0 },
  { journey_id: 3, journey_name: 'Old Draft', journey_status: 'draft', sent: 5, delivered: 5, opened: 1, clicked: 0, landed: 0, entries: 5 },
];
const mockTable = (rows: unknown[], meta: unknown = { last_run_at: new Date(Date.now() - 120000).toISOString(), journeys_run: 3 }, total: number = rows.length) =>
  vi.mocked(api.getJourneyAnalyticsTable).mockResolvedValue({ data: { journeys: rows, meta, total } });
const tableCard = () => screen.getByRole('region', { name: 'Your journeys' });
const tableText = () => tableCard().textContent ?? '';
const lastTableOpts = () => vi.mocked(api.getJourneyAnalyticsTable).mock.lastCall?.[1];
const openRowMenu = (name: string) => fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

describe('Journey Analytics page', () => {
  it('renders the compact header, journey rows, meta and plain-language rates', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    expect(screen.getByRole('heading', { level: 1, name: 'Performance' })).toBeTruthy();
    expect(bodyText()).toContain('How your journeys and messages are doing');
    expect(screen.getByText('Cart Abandon')).toBeTruthy();
    expect(screen.getAllByText('Always on').filter(e => e.tagName === 'SPAN').length).toBe(1); // chip on Cart Abandon only
    expect(tableText()).toContain('All time · numbers updated 2 minutes ago');
    expect(tableText()).toContain('50%'); // opened 40 / delivered 80
    expect(tableText()).toContain('25%'); // clicked 10 / opened 40
    expect(tableText()).toContain('Showing 1–3 of 3');
    for (const h of ['Journey', 'Status', 'Sent', 'Opened %', 'Clicked %', 'Unsubscribed']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h.replace('%', '%')}`) })).toBeTruthy();
    }
    expect(tableText()).not.toMatch(/NaN|undefined|Infinity/);
    expect(tableText()).not.toMatch(ISO_DATE);
    expect(tableText()).not.toMatch(/\bnode\b|\bQA\b/i);
  });

  it('requests page 1 of 20 by default and nothing per row on open', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('', { page: 1, limit: 20, sort: 'entries', dir: 'desc' });
    expect(api.getJourneyAnalyticsNodes).not.toHaveBeenCalled();
    expect(api.refreshJourneyAnalytics).not.toHaveBeenCalled();
    expect(api.regenerateJourneyQaReports).not.toHaveBeenCalled();
  });

  it('shows an empty message and "not yet" when there is no data', async () => {
    render(<JourneyAnalyticsPage />);
    await screen.findByText(/No journey numbers yet/);
    expect(tableText()).toContain('numbers updated not yet');
    expect(tableText()).toContain('No journeys to show');
    expect(tableText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the error message when the table API fails', async () => {
    vi.mocked(api.getJourneyAnalyticsTable).mockRejectedValue(new Error('HTTP 500'));
    render(<JourneyAnalyticsPage />);
    await screen.findByText(/HTTP 500/);
    expect(tableText()).not.toMatch(/NaN|undefined/);
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.getJourneyAnalyticsTable).mockReturnValue(new Promise(() => {}));
    render(<JourneyAnalyticsPage />);
    expect(screen.getByTestId('journeys-loading')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Your journeys' })).toBeNull();
  });

  it('status and type filters re-fetch on the server from page 1', async () => {
    mockTable(ROWS, undefined, 45);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 2 }));
    fireEvent.change(screen.getByTitle('Journey status'), { target: { value: 'paused' } });
    await waitFor(() => expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('paused', { page: 1, limit: 20, sort: 'entries', dir: 'desc' }));
    fireEvent.change(screen.getByTitle('Journey type'), { target: { value: 'continuous' } });
    await waitFor(() => expect(lastTableOpts()).toEqual({ page: 1, limit: 20, sort: 'entries', dir: 'desc', type: 'continuous' }));
  });

  it('search is sent to the server after typing pauses, and shows a no-match message', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    mockTable([]);
    fireEvent.change(screen.getByPlaceholderText('Search by name or #id'), { target: { value: ' #3 ' } });
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 1, search: '#3' }));
    await screen.findByText('No journeys match your search or filters.');
  });

  it('sorting by a column header asks the server for that order', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('button', { name: 'Journey' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ sort: 'name', dir: 'asc', page: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Journey ▲' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ sort: 'name', dir: 'desc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opened %' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ sort: 'openRate', dir: 'desc' }));
  });

  it('pages with Prev/Next, shows "Showing x–y of N" and changes page size', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({ ...ROWS[0], journey_id: 100 + i, journey_name: `J${i + 1}` }));
    mockTable(page1, undefined, 45);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('J1');
    expect(tableText()).toContain('Showing 1–20 of 45');
    expect(tableText()).toContain('Page 1 of 3');
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 2, limit: 20 }));
    await waitFor(() => expect(tableText()).toContain('Showing 21–40 of 45'));

    mockTable(page1.slice(0, 5), undefined, 45);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 3 }));
    await waitFor(() => expect(tableText()).toContain('Showing 41–45 of 45'));
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 2 }));

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    await waitFor(() => expect(lastTableOpts()).toMatchObject({ page: 1, limit: 50 }));
  });

  it('pages on the client when an older API returns no total', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...ROWS[0], journey_id: 200 + i, journey_name: `Old${i + 1}` }));
    vi.mocked(api.getJourneyAnalyticsTable).mockResolvedValue({ data: { journeys: many, meta: null } });
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Old1');
    expect(screen.queryByText('Old21')).toBeNull();
    expect(tableText()).toContain('Showing 1–20 of 25');
  });

  it('loads a journey\'s steps only when its row is opened (filtering __ALL__) and passes the day', async () => {
    mockTable(ROWS);
    vi.mocked(api.getJourneyAnalyticsNodes).mockResolvedValue({ data: [
      { node_id: '__ALL__', node_label: 'Aggregate', journey_id: 1, journey_status: 'active', sent: 1, delivered: 1, opened: 0, clicked: 0, landed: 0 },
      { node_id: 'node_1', node_label: 'Day 1 email', node_type: 'action', template_id: 7, journey_id: 1, journey_status: 'active', sent: 10, delivered: 8, opened: 4, human_opened: 3, clicked: 1, landed: 0 },
    ] });
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    expect(api.getJourneyAnalyticsNodes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Welcome Series'));
    await screen.findByText('Day 1 email');
    expect(api.getJourneyAnalyticsNodes).toHaveBeenCalledTimes(1);
    expect(api.getJourneyAnalyticsNodes).toHaveBeenCalledWith(1, undefined);
    expect(screen.queryByText(/Aggregate/)).toBeNull();
    expect(tableText()).toContain('3 real people');
    expect(tableText()).toContain('People entered');
    expect(screen.getByRole('link', { name: /Open journey/ }).getAttribute('href')).toBe('/journeys/1');
    // collapse
    fireEvent.click(screen.getByText('Welcome Series'));
    expect(screen.queryByText('Day 1 email')).toBeNull();

    fireEvent.change(screen.getByLabelText('Step breakdown day'), { target: { value: '2026-10-01' } });
    vi.mocked(api.getJourneyAnalyticsNodes).mockResolvedValue({ data: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Show steps for Welcome Series' }));
    await screen.findByText(/^No step sent on Thu, 1 Oct/);
    expect(api.getJourneyAnalyticsNodes).toHaveBeenLastCalledWith(1, '2026-10-01');
    expect(tableText()).not.toMatch(ISO_DATE);
  });

  it('opens the email check for a step', async () => {
    mockTable(ROWS);
    vi.mocked(api.getJourneyAnalyticsNodes).mockResolvedValue({ data: [
      { node_id: 'node_1', node_label: 'Day 1 email', template_id: 7, journey_id: 1, journey_status: 'active', sent: 1, delivered: 1, opened: 0, clicked: 0, landed: 0 },
    ] });
    vi.mocked(api.getStoredQaReport).mockReturnValue(new Promise(() => {}));
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    fireEvent.click(await screen.findByRole('button', { name: 'See the email check for Day 1 email' }));
    await waitFor(() => expect(api.getStoredQaReport).toHaveBeenCalledWith(7));
  });

  it('shows step load errors inline', async () => {
    mockTable(ROWS);
    vi.mocked(api.getJourneyAnalyticsNodes).mockRejectedValue(new Error('nodes boom'));
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await screen.findByText('nodes boom');
  });

  it('the row ⋯ menu updates one journey and reloads, without loading steps', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    const before = vi.mocked(api.getJourneyAnalyticsTable).mock.calls.length;
    openRowMenu('Cart Abandon');
    expect(within(screen.getByRole('menu')).getByRole('link', { name: /Open journey/ }).getAttribute('href')).toBe('/journeys/2');
    fireEvent.click(screen.getByRole('menuitem', { name: /Update numbers now/ }));
    await waitFor(() => expect(api.refreshJourneyAnalytics).toHaveBeenCalledWith(2));
    await waitFor(() => expect(vi.mocked(api.getJourneyAnalyticsTable).mock.calls.length).toBe(before + 1));
    expect(api.getJourneyAnalyticsNodes).not.toHaveBeenCalled();
  });

  it('re-running email checks alerts with the result counts', async () => {
    vi.mocked(api.regenerateJourneyQaReports).mockResolvedValue({ data: { ok: 4, failed: 1, total: 6 } });
    render(<JourneyAnalyticsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'More table actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Re-run email checks/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Email checks finished — 4 updated, 1 failed, 0 skipped (of 6 emails).'));
  });

  it('email check failure alerts the error', async () => {
    vi.mocked(api.regenerateJourneyQaReports).mockRejectedValue(new Error('nope'));
    render(<JourneyAnalyticsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'More table actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Re-run email checks/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Email checks failed: nope'));
  });

  it('Download CSV fetches every page with the current filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockTable(ROWS, undefined, 3);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.change(screen.getByTitle('Journey status'), { target: { value: 'active' } });
    await waitFor(() => expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('active', expect.objectContaining({ page: 1 })));
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('active', { page: 1, limit: 200, sort: 'entries', dir: 'desc' });
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('handles rows with null/missing metrics without NaN', async () => {
    mockTable([{ journey_id: 9, journey_name: 'Sparse', journey_status: 'weird', sent: null, delivered: null, opened: null, clicked: null, landed: null }], null);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Sparse');
    expect(screen.getByText('Weird')).toBeTruthy();
    expect(tableText()).toContain('—');
    expect(tableText()).not.toMatch(/NaN|undefined|null|Infinity/);
  });
});

const INSIGHTS: api.OverviewInsights = {
  range: { from: '2026-09-20', to: '2026-10-19', days: 30 },
  totals: { available: true, sent: 1200, delivered: 1100, opened: 440, clicked: 66, unsubscribed: 3 },
  previous: { available: true, from: '2026-08-21', to: '2026-09-19', sent: 1000, delivered: 1000, opened: 0, clicked: 66, unsubscribed: 6 },
  weeklyTrend: { available: true, weeks: [
    { week: '2026-09-21', sent: 300, opened: 120, clicked: 15, openRate: 40, clickRate: 5 },
    { week: '2026-09-28', sent: 400, opened: 140, clicked: 20, openRate: 35, clickRate: 5 },
  ] },
  funnel: { available: true, channel: 'email', sent: 1000, opened: 400, clicked: 60, converted: 6 },
  journeys: { available: true, rows: [
    { id: 41, name: 'Visa Reminder', status: 'active', sent: 500, opened: 200, clicked: 25, unsubscribed: 1, openRate: 40, clickRate: 5 },
  ] },
};
const UNAVAILABLE = { available: false, reason: 'unavailable' } as const;

describe('Performance overview', () => {
  it('requests the last 7 days by default and renders KPIs with real vs-previous changes', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    const [from, to] = vi.mocked(api.getOverviewInsights).mock.calls[0];
    expect(typeof from).toBe('string');
    expect((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000).toBe(6);
    // INSIGHTS.range.days is 30, so the wording follows the period the API reports
    expect(bodyText()).toContain('↑ 20% vs previous 30 days'); // sent 1200 vs 1000
    expect(bodyText()).toContain('↑ 10% vs previous 30 days'); // delivered 1100 vs 1000
    expect(bodyText()).toContain('Up from 0 in the previous 30 days'); // opened prev 0
    expect(bodyText()).toContain('Same as before'); // clicked 66 vs 66
    expect(bodyText()).toContain('↓ 50% vs previous 30 days'); // unsub 3 vs 6
    expect(bodyText()).toContain('Compared with');
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('labels email-only sections and renders the funnel and weekly chart', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('From sent to booked');
    expect(screen.getAllByText('Email only').length).toBe(3); // Clicked KPI, funnel, trend
    expect(bodyText()).toContain('40% of sent'); // opened 400/1000
    expect(bodyText()).toContain('0.6% of sent'); // booked 6/1000
    expect(screen.getByText('Opens and clicks by week')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('switching preset and custom range re-fetches with new dates', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => {
      const [f, t] = vi.mocked(api.getOverviewInsights).mock.lastCall ?? [];
      expect((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000).toBe(29);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Period to'), { target: { value: '2026-01-31' } });
    await waitFor(() => expect(api.getOverviewInsights).toHaveBeenLastCalledWith('2026-01-01', '2026-01-31'));
    const calls = vi.mocked(api.getOverviewInsights).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-02-15' } });
    expect(screen.getByText(/Pick a valid from and to date/)).toBeTruthy();
    expect(vi.mocked(api.getOverviewInsights).mock.calls.length).toBe(calls);
  });

  it('shows "Not available right now" for unavailable sections without numbers', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      range: INSIGHTS.range, totals: UNAVAILABLE, previous: UNAVAILABLE, weeklyTrend: UNAVAILABLE, funnel: UNAVAILABLE, journeys: UNAVAILABLE,
    });
    render(<JourneyAnalyticsPage />);
    await waitFor(() => expect(screen.getAllByText('Not available right now').length).toBe(3));
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows "No data for the previous period" when only previous is missing', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({ ...INSIGHTS, previous: UNAVAILABLE });
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    expect(screen.getAllByText('No data for the previous period').length).toBe(5);
    expect(bodyText()).not.toContain('than the previous');
  });

  it('handles zero sends without NaN', async () => {
    const zero = { sent: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0 };
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      range: INSIGHTS.range,
      totals: { available: true, ...zero },
      previous: { available: true, from: '2026-08-21', to: '2026-09-19', ...zero },
      weeklyTrend: { available: true, weeks: [] },
      funnel: { available: true, channel: 'email', sent: 0, opened: 0, clicked: 0, converted: 0 },
      journeys: { available: true, rows: [] },
    });
    render(<JourneyAnalyticsPage />);
    await waitFor(() => expect(screen.getAllByText('No data for this period').length).toBe(2));
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows an error with retry when the insights API fails, and keeps the journey table', async () => {
    mockTable(ROWS);
    vi.mocked(api.getOverviewInsights).mockRejectedValueOnce(new Error('HTTP 502'));
    render(<JourneyAnalyticsPage />);
    await screen.findByText("Couldn't load performance data");
    expect(screen.getByText('Welcome Series')).toBeTruthy();
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    fireEvent.click(screen.getByText('Try again'));
    await screen.findByText('1,200');
    expect(screen.queryByText("Couldn't load performance data")).toBeNull();
  });
});
