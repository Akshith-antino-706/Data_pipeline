// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import JourneyDashboardPage from '@/app/(dashboard)/journeys/dashboard/page';

vi.mock('@/lib/api');
const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/journeys/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

class RO { observe(): void {} unobserve(): void {} disconnect(): void {} }
const fetchStub = vi.fn<() => Promise<Response>>(() => Promise.reject(new Error('network disabled')));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

const JOURNEYS = [
  { journeyId: 11, name: 'Welcome Flow', status: 'active', nodes: [], activeEntries: 1200, nextFire: '2026-10-20T06:00:00Z', sendsToday: 300, openRate: 22.5, conversions: 7 },
  { journeyId: 12, name: 'Winback', status: 'paused', nodes: [], activeEntries: 0, nextFire: null, sendsToday: 0, openRate: 0, conversions: 0 },
];
const FULL = {
  generatedAt: '2026-10-19T08:00:00Z',
  kpis: { activeJourneys: 4, activeEntries: 12345, sendsToday: 900, sendsTomorrow: 800, queuedNow: 5, openRate7d: 31.2, conversions7d: 17 },
  forecast: [{ date: '2026-10-25', total: 50, items: [{ journeyId: 11, nodeId: 'node_2', journeyName: 'Welcome Flow', dayNumber: 3, label: 'Day 3 email', sendHour: 9, approximate: true, count: 50 }] }],
  forecastChart: [{ date: '2026-10-25', 'Welcome Flow': 50 }],
  forecastJourneyNames: ['Welcome Flow'],
  runningNow: [{ journeyId: 11, journeyName: 'Welcome Flow', nodes: [
    { nodeId: 'node_1', label: 'Wait 2d', type: 'wait', count: 30, failed: 0 },
    { nodeId: 'node_2', label: 'Email 2', type: 'action', count: 10, failed: 0 },
  ] }],
  engagement: [],
  journeys: JOURNEYS,
  health: { stuckEntries: [{ name: 'Welcome Flow', count: 4 }], aiFallback: [{ dayNumber: 3 }] },
};
const mockDash = (data: unknown) => vi.mocked(api.getJourneyOpsDashboard).mockResolvedValue({ data });

describe('Journey Operations dashboard', () => {
  it('renders KPIs, forecast, running-now, health alerts and journeys', async () => {
    mockDash(FULL);
    render(<JourneyDashboardPage />);
    await screen.findByText('12,345');
    expect(screen.getByText('31.2%')).toBeTruthy();
    expect(screen.getByText('4 entries are overdue')).toBeTruthy();
    expect(screen.getByText(/1 of today's daily templates used fallback/)).toBeTruthy();
    expect(screen.getByText('DAY 3')).toBeTruthy();
    expect(bodyText()).toContain('09:00 GST');
    expect(bodyText()).toContain('branch est.');
    expect(screen.getByText('40 active')).toBeTruthy();
    expect(screen.getAllByText('Welcome Flow').length).toBeGreaterThan(1);
    expect(screen.getByText('Winback')).toBeTruthy();
    expect(screen.getByText('No journey sends in the last 30 days')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows empty states when the dashboard payload has empty sections', async () => {
    mockDash({ kpis: { activeJourneys: 0, activeEntries: 0, sendsToday: 0, sendsTomorrow: 0, queuedNow: 0, openRate7d: 0, conversions7d: 0 }, forecast: [], forecastChart: [], runningNow: [], engagement: [], journeys: [], health: {} });
    render(<JourneyDashboardPage />);
    await screen.findByText('No journey sends scheduled in the next 7 days');
    expect(screen.getByText('No active enrollments')).toBeTruthy();
    expect(screen.getByText('No journeys')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  // BUG: app/(dashboard)/journeys/dashboard/page.tsx:173 renders the Open Rate KPI as
  // `${kpis.openRate7d}%` — when the API omits openRate7d (or kpis entirely) the tile shows
  // "undefined%" instead of falling back to 0 like the other tiles (`k.value ?? 0`).
  it('Open Rate KPI never renders "undefined%" when kpis are missing', async () => {
    mockDash({ journeys: [] });
    render(<JourneyDashboardPage />);
    await screen.findByText('No journeys');
    expect(bodyText()).not.toContain('undefined');
  });

  it('journey row open rate never renders "undefined%"', async () => {
    mockDash({ ...FULL, journeys: [{ journeyId: 5, name: 'No Rate', status: 'draft', nodes: [], activeEntries: 0, sendsToday: 0, conversions: 0 }] });
    render(<JourneyDashboardPage />);
    await screen.findByText('No Rate');
    expect(bodyText()).not.toContain('undefined');
  });

  it('shows an error card with Retry when the dashboard API fails', async () => {
    vi.mocked(api.getJourneyOpsDashboard).mockRejectedValue(new Error('HTTP 502'));
    render(<JourneyDashboardPage />);
    await screen.findByText('HTTP 502');
    mockDash(FULL);
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByText('12,345');
    expect(api.getJourneyOpsDashboard).toHaveBeenCalledTimes(2);
  });

  it('renders the header and skeletons while loading', () => {
    vi.mocked(api.getJourneyOpsDashboard).mockReturnValue(new Promise(() => {}));
    const { container } = render(<JourneyDashboardPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Journey monitor' })).toBeTruthy();
    expect(bodyText()).toContain('· loading…');
    expect(container.querySelectorAll('.ui-skel').length).toBeGreaterThanOrEqual(7);
  });

  it('status chips filter the journey list', async () => {
    mockDash(FULL);
    render(<JourneyDashboardPage />);
    await screen.findByText('Winback');
    fireEvent.click(screen.getByRole('button', { name: /^paused/ }));
    expect(screen.getByText('Winback')).toBeTruthy();
    expect(screen.queryByText('1,200 active · next fire', { exact: false })).toBeNull();
  });

  it('expanding a journey lazily loads its node breakdown and opens template preview', async () => {
    mockDash(FULL);
    vi.mocked(api.getJourneyNodeBreakdown).mockResolvedValue({ data: { nodes: [
      { nodeId: 'node_2', label: 'Send Email X', type: 'action', count: 0, delivered: 100, opened: 40, clicked: 5, failed: 2, openRate: 40, clickRate: 5, hasTemplate: true, total: 100 },
      { nodeId: 'node_3', label: 'Wait step', type: 'wait', count: 0, failed: 0, waitDays: 3 },
    ] } });
    vi.mocked(api.previewJourneyNodeEmail).mockResolvedValue({ data: { html: '<p>hi</p>', subject: 'Hello there' } });
    render(<JourneyDashboardPage />);
    await screen.findByText('Winback');
    fireEvent.click(screen.getByText('Winback'));
    await screen.findByText('Send Email X');
    expect(api.getJourneyNodeBreakdown).toHaveBeenCalledWith(12);
    expect(bodyText()).toContain('waits 3d');
    fireEvent.click(screen.getByText('Template'));
    await screen.findByText(/Hello there/);
    expect(api.previewJourneyNodeEmail).toHaveBeenCalledWith(12, 'node_2');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the node breakdown error inline', async () => {
    mockDash(FULL);
    vi.mocked(api.getJourneyNodeBreakdown).mockRejectedValue(new Error('breakdown failed'));
    render(<JourneyDashboardPage />);
    await screen.findByText('Winback');
    fireEvent.click(screen.getByText('Winback'));
    await screen.findByText('breakdown failed');
  });

  it('date filter fetches journeys active on that date, with error handling', async () => {
    mockDash(FULL);
    vi.mocked(api.getJourneysActiveOnDate).mockResolvedValue({ data: { journeys: [
      { journeyId: 21, name: 'Dated Journey', status: 'active', nodes: [{ nodeId: 'n1', label: 'N1', type: 'action', count: 1, failed: 0 }], sentOnDate: 12, scheduledOnDate: 3 },
    ] } });
    const { container } = render(<JourneyDashboardPage />);
    await screen.findByText('Winback');
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-10-25' } });
    await screen.findByText('Dated Journey');
    expect(api.getJourneysActiveOnDate).toHaveBeenCalledWith('2026-10-25');
    expect(bodyText()).toContain('12 sent · 3 scheduled');

    vi.mocked(api.getJourneysActiveOnDate).mockRejectedValue(new Error('date boom'));
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-10-26' } });
    await screen.findByText('date boom');

    fireEvent.click(screen.getByText('All time'));
    await screen.findByText('Winback');
  });

  it('clicking a forecast item and the open-journey button navigate to the journey', async () => {
    mockDash(FULL);
    render(<JourneyDashboardPage />);
    await screen.findByText('Day 3 email');
    fireEvent.click(screen.getByText('Day 3 email'));
    expect(nav.push).toHaveBeenCalledWith('/journeys?id=11');
    fireEvent.click(screen.getAllByTitle('Open journey')[1]);
    expect(nav.push).toHaveBeenLastCalledWith('/journeys?id=12');
  });

  it('Refresh re-fetches the dashboard', async () => {
    mockDash(FULL);
    render(<JourneyDashboardPage />);
    await screen.findByText('12,345');
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(api.getJourneyOpsDashboard).toHaveBeenCalledTimes(2));
  });
});
