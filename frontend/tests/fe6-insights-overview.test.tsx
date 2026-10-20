// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import * as api from '@/lib/api';
import InsightsOverview from '@/app/(dashboard)/journeys/analytics/InsightsOverview';

vi.mock('@/lib/api');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const bodyText = (): string => document.body.textContent ?? '';
const daysBetween = (f: string | undefined, t: string | undefined) =>
  (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000;
const expectClean = () => {
  expect(bodyText()).not.toMatch(/NaN|undefined|Infinity|null/);
  expect(bodyText()).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no raw ISO dates
};

const UNAVAILABLE = { available: false, reason: 'unavailable' } as const;
const INSIGHTS: api.OverviewInsights = {
  range: { from: '2026-10-13', to: '2026-10-19', days: 7 },
  totals: { available: true, sent: 12000, delivered: 11000, opened: 4400, clicked: 660, unsubscribed: 3 },
  previous: { available: true, from: '2026-10-06', to: '2026-10-12', sent: 10000, delivered: 11000, opened: 0, clicked: 600, unsubscribed: 6 },
  weeklyTrend: { available: true, weeks: [
    { week: '2026-10-06', sent: 3000, opened: 1200, clicked: 150, openRate: 40, clickRate: 5 },
    { week: '2026-10-13', sent: 1000, opened: 350, clicked: 50, openRate: 35, clickRate: 5 },
  ] },
  funnel: { available: true, channel: 'email', sent: 1000, opened: 400, clicked: 60, converted: 6 },
  journeys: { available: true, rows: [] },
};

describe('InsightsOverview', () => {
  it('requests the last 7 days by default and shows the five KPI tiles with plain help', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<InsightsOverview />);
    await screen.findByText('12,000');
    const [from, to] = vi.mocked(api.getOverviewInsights).mock.calls[0];
    expect(daysBetween(from, to)).toBe(6);
    expect(screen.getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed')).toBe('true');

    const glance = screen.getByRole('region', { name: 'At a glance' });
    for (const label of ['Messages sent', 'Delivered', 'Opened', 'Clicked', 'Unsubscribed']) {
      expect(within(glance).getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('At a glance')).toBeTruthy();
    expect(screen.getByText('Emails opened and WhatsApp messages read')).toBeTruthy();
    expect(bodyText()).toContain('91.7% of sent'); // delivered 11000/12000
    expect(bodyText()).toContain('40% of delivered'); // opened 4400/11000
    expect(bodyText()).toContain('15% of opened'); // clicked 660/4400
    expect(within(screen.getByTestId('kpi-clicked')).getByText('Email only')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-sent')).getByText('All channels')).toBeTruthy();
    expect(bodyText()).toContain('13 Oct – 19 Oct 2026 · Compared with 6 Oct – 12 Oct 2026');
    expectClean();
  });

  it('describes the change vs the previous 7 days in words, with fewer unsubscribes shown as good', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<InsightsOverview />);
    await screen.findByText('12,000');
    const change = (key: string) => within(screen.getByTestId(`kpi-${key}`)).getByText(/previous|Same as before/);
    expect(change('sent').textContent).toBe('↑ 20% vs previous 7 days');
    expect(change('sent').className).toMatch(/changeGood/);
    expect(change('delivered').textContent).toBe('Same as before');
    expect(change('opened').textContent).toBe('↑ Up from 0 in the previous 7 days');
    expect(change('clicked').textContent).toBe('↑ 10% vs previous 7 days');
    expect(change('unsubscribed').textContent).toBe('↓ 50% vs previous 7 days');
    expect(change('unsubscribed').className).toMatch(/changeGood/);
  });

  it('marks more unsubscribes as bad and says when the previous period has no data', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      ...INSIGHTS,
      previous: { available: true, from: '2026-10-06', to: '2026-10-12', sent: 24000, delivered: 1, opened: 1, clicked: 1, unsubscribed: 1 },
    });
    render(<InsightsOverview />);
    await screen.findByText('12,000');
    const unsub = within(screen.getByTestId('kpi-unsubscribed')).getByText(/previous/);
    expect(unsub.textContent).toBe('↑ 200% vs previous 7 days');
    expect(unsub.className).toMatch(/changeBad/);
    const sent = within(screen.getByTestId('kpi-sent')).getByText(/previous/);
    expect(sent.textContent).toBe('↓ 50% vs previous 7 days');
    expect(sent.className).toMatch(/changeBad/);

    cleanup();
    vi.mocked(api.getOverviewInsights).mockResolvedValue({ ...INSIGHTS, previous: UNAVAILABLE });
    render(<InsightsOverview />);
    await screen.findByText('12,000');
    expect(screen.getAllByText('No data for the previous period').length).toBe(5);
    expect(bodyText()).not.toContain('Compared with');
  });

  it('falls back to "of sent" for the open rate when nothing is marked delivered', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      ...INSIGHTS,
      totals: { available: true, sent: 200, delivered: 0, opened: 50, clicked: 0, unsubscribed: 0 },
    });
    render(<InsightsOverview />);
    await screen.findByText('200');
    expect(within(screen.getByTestId('kpi-opened')).getByText('25% of sent')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-clicked')).getByText('0% of opened')).toBeTruthy();
    expect(within(screen.getByTestId('kpi-delivered')).queryByText(/of sent/)).toBeTruthy();
    expectClean();
  });

  it('renders the weekly chart with week labels, overall rates and an accessible summary', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<InsightsOverview />);
    await screen.findByText('Opens and clicks by week');
    const img = screen.getByRole('img', { name: /Open rate and click rate by week/ });
    const label = img.getAttribute('aria-label') ?? '';
    expect(label).toContain('2 weeks');
    expect(label).toContain('Overall open rate 38.8% and click rate 5% of 4,000 emails sent'); // 1550/4000, 200/4000
    expect(label).toContain('Latest week (w/c 13 Oct): open rate 35%, click rate 5%');
    expect(bodyText()).toContain('Open rate 38.8%');
    expect(bodyText()).toContain('Click rate 5%');
  });

  it('renders the funnel with counts, % of sent and the biggest drop', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<InsightsOverview />);
    await screen.findByText('From sent to booked');
    const list = screen.getByRole('list', { name: /Funnel from sent to booked/ });
    expect(list.getAttribute('aria-label')).toBe(
      'Funnel from sent to booked: Sent 1,000, Opened 400 (40% of sent), Clicked 60 (6% of sent), Booked 6 (0.6% of sent)',
    );
    expect(within(list).getAllByRole('listitem').length).toBe(4);
    expect(within(list).getByText('1,000')).toBeTruthy();
    expect(within(list).getByText('40% of sent')).toBeTruthy();
    expect(within(list).getByText('0.6% of sent')).toBeTruthy();
    expect(bodyText()).toContain('Where people drop off');
    expect(bodyText()).toContain('Biggest drop: Clicked → Booked (90% clicked but didn\'t book)');
  });

  it('shows "No data for this period" for empty charts', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      ...INSIGHTS,
      weeklyTrend: { available: true, weeks: [] },
      funnel: { available: true, channel: 'email', sent: 0, opened: 0, clicked: 0, converted: 0 },
    });
    render(<InsightsOverview />);
    await waitFor(() => expect(screen.getAllByText('No data for this period').length).toBe(2));
    expect(screen.queryByRole('img')).toBeNull();
    expectClean();
  });

  it('shows "Not available right now" with Try again for unavailable sections', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue({
      range: INSIGHTS.range, totals: UNAVAILABLE, previous: UNAVAILABLE, weeklyTrend: UNAVAILABLE, funnel: UNAVAILABLE, journeys: UNAVAILABLE,
    });
    render(<InsightsOverview />);
    await waitFor(() => expect(screen.getAllByText('Not available right now').length).toBe(3));
    expectClean();
    const calls = vi.mocked(api.getOverviewInsights).mock.calls.length;
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    await screen.findByText('12,000');
    expect(vi.mocked(api.getOverviewInsights).mock.calls.length).toBe(calls + 1);
    expect(screen.queryByText('Not available right now')).toBeNull();
  });

  it('shows skeletons while loading, then an error with Try again', async () => {
    let reject: (e: Error) => void = () => {};
    vi.mocked(api.getOverviewInsights).mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    render(<InsightsOverview />);
    expect(screen.getByTestId('insights-loading')).toBeTruthy();
    reject(new Error('HTTP 502'));
    await screen.findByText("Couldn't load performance data");
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('12,000');
    expect(screen.queryByText("Couldn't load performance data")).toBeNull();
  });

  it('switches presets and custom ranges, and guards an invalid range', async () => {
    vi.mocked(api.getOverviewInsights).mockResolvedValue(INSIGHTS);
    render(<InsightsOverview />);
    await screen.findByText('12,000');
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    await waitFor(() => {
      const [f, t] = vi.mocked(api.getOverviewInsights).mock.lastCall ?? [];
      expect(daysBetween(f, t)).toBe(89);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Period to'), { target: { value: '2026-01-31' } });
    await waitFor(() => expect(api.getOverviewInsights).toHaveBeenLastCalledWith('2026-01-01', '2026-01-31'));
    const calls = vi.mocked(api.getOverviewInsights).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Period from'), { target: { value: '2026-02-15' } });
    expect(screen.getByText(/Pick a valid from and to date/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Refresh/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(api.getOverviewInsights).mock.calls.length).toBe(calls);
  });
});
