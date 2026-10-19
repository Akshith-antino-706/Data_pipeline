// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
  { journey_id: 1, journey_name: 'Welcome Series', journey_status: 'active', journey_type: 'fixed', entries: 100, sent: 90, delivered: 80, failed: 2, opened: 40, human_opened: 30, clicked: 10, human_clicked: 8, landed: 3, bounced: 1, unsubscribed: 0, gtm_events: 5, booked: 1, bot_window_sec: 20 },
  { journey_id: 2, journey_name: 'Cart Abandon', journey_status: 'paused', journey_type: 'gtm', entries: 500, sent: 0, delivered: 0, opened: 0, clicked: 0, landed: 0 },
  { journey_id: 3, journey_name: 'Old Draft', journey_status: 'draft', sent: 5, delivered: 5, opened: 1, clicked: 0, landed: 0, entries: 5 },
];
const mockTable = (rows: unknown[], meta: unknown = { last_run_at: new Date(Date.now() - 120000).toISOString(), journeys_run: 3 }) =>
  vi.mocked(api.getJourneyAnalyticsTable).mockResolvedValue({ data: { journeys: rows, meta } });

describe('Journey Analytics page', () => {
  it('renders journey rows, meta and computed rates', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    expect(screen.getByText('Cart Abandon')).toBeTruthy();
    expect(screen.getByText('CONT')).toBeTruthy();
    expect(bodyText()).toContain('Snapshot updated 2m ago · 3 journeys');
    expect(bodyText()).toContain('engagement ≥ 20s');
    expect(bodyText()).toContain('50%'); // open rate 40/80
    expect(bodyText()).toContain('25%'); // CTOR 10/40
    expect(bodyText()).toContain('3 of 3');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows empty-rollup message and "never" when there is no data', async () => {
    render(<JourneyAnalyticsPage />);
    await screen.findByText(/No journeys in the rollup yet/);
    expect(bodyText()).toContain('Snapshot updated never');
    expect(bodyText()).toContain('0 of 0');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the error message when the table API fails', async () => {
    vi.mocked(api.getJourneyAnalyticsTable).mockRejectedValue(new Error('HTTP 500'));
    render(<JourneyAnalyticsPage />);
    await screen.findByText('HTTP 500');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.getJourneyAnalyticsTable).mockReturnValue(new Promise(() => {}));
    const { container } = render(<JourneyAnalyticsPage />);
    expect(container.querySelectorAll('.skeleton').length).toBe(8);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('status filter re-fetches with the selected status', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('');
    fireEvent.change(screen.getByTitle('Journey status'), { target: { value: 'paused' } });
    await waitFor(() => expect(api.getJourneyAnalyticsTable).toHaveBeenLastCalledWith('paused'));
  });

  it('type filter and search narrow the list client-side', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.change(screen.getByTitle('Journey type'), { target: { value: 'continuous' } });
    expect(screen.queryByText('Welcome Series')).toBeNull();
    expect(screen.getByText('Cart Abandon')).toBeTruthy();
    fireEvent.change(screen.getByTitle('Journey type'), { target: { value: 'fixed' } });
    expect(screen.queryByText('Cart Abandon')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search journey or #id…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No journeys match the current filters.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search journey or #id…'), { target: { value: '#3' } });
    expect(screen.getByText('Old Draft')).toBeTruthy();
    expect(screen.queryByText('Welcome Series')).toBeNull();
  });

  it('sorts by name when the Journey header is clicked', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    const names = () => screen.getAllByText(/^(Welcome Series|Cart Abandon|Old Draft)$/).map(e => e.textContent);
    // default: entries desc
    expect(names()).toEqual(['Cart Abandon', 'Welcome Series', 'Old Draft']);
    fireEvent.click(screen.getByText('Journey'));
    expect(names()).toEqual(['Welcome Series', 'Old Draft', 'Cart Abandon']);
    fireEvent.click(screen.getByText('Journey ▼'));
    expect(names()).toEqual(['Cart Abandon', 'Old Draft', 'Welcome Series']);
  });

  it('expanding a journey loads nodes (filtering __ALL__) and passes the date', async () => {
    mockTable(ROWS);
    vi.mocked(api.getJourneyAnalyticsNodes).mockResolvedValue({ data: [
      { node_id: '__ALL__', node_label: 'Aggregate', journey_id: 1, journey_status: 'active', sent: 1, delivered: 1, opened: 0, clicked: 0, landed: 0 },
      { node_id: 'node_1', node_label: 'Day 1 email', node_type: 'action', template_id: 7, journey_id: 1, journey_status: 'active', sent: 1, delivered: 1, opened: 0, clicked: 0, landed: 0 },
    ] });
    const { container } = render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await screen.findByText(/Day 1 email/);
    expect(api.getJourneyAnalyticsNodes).toHaveBeenCalledWith(1, undefined);
    expect(screen.queryByText(/Aggregate/)).toBeNull();
    // collapse
    fireEvent.click(screen.getByText('Welcome Series'));
    expect(screen.queryByText(/Day 1 email/)).toBeNull();

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-10-01' } });
    vi.mocked(api.getJourneyAnalyticsNodes).mockResolvedValue({ data: [] });
    fireEvent.click(screen.getByText('Welcome Series'));
    await screen.findByText('No node fired on 2026-10-01.');
    expect(api.getJourneyAnalyticsNodes).toHaveBeenLastCalledWith(1, '2026-10-01');
  });

  it('shows node load errors inline', async () => {
    mockTable(ROWS);
    vi.mocked(api.getJourneyAnalyticsNodes).mockRejectedValue(new Error('nodes boom'));
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await screen.findByText('nodes boom');
  });

  it('refresh button recomputes one journey and reloads', async () => {
    mockTable(ROWS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Welcome Series');
    const before = vi.mocked(api.getJourneyAnalyticsTable).mock.calls.length;
    fireEvent.click(screen.getAllByTitle('Recompute this journey now')[0]);
    await waitFor(() => expect(api.refreshJourneyAnalytics).toHaveBeenCalledWith(2));
    await waitFor(() => expect(vi.mocked(api.getJourneyAnalyticsTable).mock.calls.length).toBe(before + 1));
    expect(api.getJourneyAnalyticsNodes).not.toHaveBeenCalled();
  });

  it('regenerate reports alerts with the result counts', async () => {
    vi.mocked(api.regenerateJourneyQaReports).mockResolvedValue({ data: { ok: 4, failed: 1, total: 6 } });
    render(<JourneyAnalyticsPage />);
    fireEvent.click(screen.getByText(/Regenerate reports/));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('QA reports regenerated — 4 updated, 1 failed, 0 skipped (of 6 templates).'));
  });

  it('regenerate failure alerts the error', async () => {
    vi.mocked(api.regenerateJourneyQaReports).mockRejectedValue(new Error('nope'));
    render(<JourneyAnalyticsPage />);
    fireEvent.click(screen.getByText(/Regenerate reports/));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Regenerate failed: nope'));
  });

  it('handles rows with null/missing metrics without NaN', async () => {
    mockTable([{ journey_id: 9, journey_name: 'Sparse', journey_status: 'weird', sent: null, delivered: null, opened: null, clicked: null, landed: null }], null);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Sparse');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
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
  it('requests the last 30 days by default and renders KPIs with real vs-previous changes', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    const [from, to] = vi.mocked(api.getOverviewInsights).mock.calls[0];
    expect(typeof from).toBe('string');
    expect((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000).toBe(29);
    expect(bodyText()).toContain('▲ 20% vs previous period'); // sent 1200 vs 1000
    expect(bodyText()).toContain('▲ 10% vs previous period'); // delivered 1100 vs 1000
    expect(bodyText()).toContain('None in previous period'); // opened prev 0
    expect(bodyText()).toContain('No change vs previous period'); // clicked 66 vs 66
    expect(bodyText()).toContain('▼ 50% vs previous period'); // unsub 3 vs 6
    expect(bodyText()).toContain('Compared with');
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('labels email-only sections and renders funnel and per-journey rows', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('Visa Reminder');
    expect(screen.getAllByText('Email').length).toBeGreaterThanOrEqual(4); // Clicked KPI, funnel, trend, by journey
    expect(screen.getByText('From sent to booked')).toBeTruthy();
    expect(bodyText()).toContain('40% of sent'); // opened 400/1000
    expect(bodyText()).toContain('10% of clicked'); // booked 6/60
    expect(screen.getByText('Open and click rate by week')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Per-journey performance' })).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('switching preset and custom range re-fetches with new dates', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => {
      const [f, t] = vi.mocked(api.getOverviewInsights).mock.lastCall ?? [];
      expect((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000).toBe(6);
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
    await waitFor(() => expect(screen.getAllByText('Not available right now').length).toBe(4));
    expect(bodyText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows "Previous period not available" when only previous is missing', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({ ...INSIGHTS, previous: UNAVAILABLE });
    render(<JourneyAnalyticsPage />);
    await screen.findByText('1,200');
    expect(screen.getAllByText('Previous period not available').length).toBe(5);
    expect(bodyText()).not.toContain('vs previous period');
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
    await screen.findByText('Nothing was sent in this period.');
    expect(screen.getByText('No journey emails were sent in this period.')).toBeTruthy();
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
