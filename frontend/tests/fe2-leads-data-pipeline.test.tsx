// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, within, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import DataPipeline from '@/app/(dashboard)/data-pipeline/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type Mapping = Awaited<ReturnType<typeof api.getMappingStats>>;
type Status = Awaited<ReturnType<typeof api.getOverviewStatus>>;

const STATUS_OK: Status = {
  dataSources: { available: true, sources: [
    { name: 'rayna_tours', status: 'success', lastSyncedAt: '2026-10-19T06:00:00Z', lastRunAt: '2026-10-19T06:00:00Z', rows: 4321, durationMs: 3400, error: null },
    { name: 'gtm_events', status: 'error', lastSyncedAt: null, lastRunAt: '2026-10-19T05:00:00Z', rows: 0, durationMs: 0, error: 'bigquery quota exceeded' },
  ] },
  queues: { available: true, queues: [
    { channel: 'email', available: true, waiting: 12, active: 2, delayed: 0, completed: 900, failed: 0, paused: 0 },
    { channel: 'whatsapp', available: true, waiting: 0, active: 0, delayed: 0, completed: 50, failed: 3, paused: 0 },
    { channel: 'sms', available: false },
  ] },
  failedSends: { available: true, rows: [
    { channel: 'whatsapp', id: 77, recipient: '+971500000000', reason: 'template rejected', time: '2026-10-19T07:00:00Z', journeyId: 5 },
  ] },
};
const STATUS_HEALTHY: Status = {
  dataSources: { available: true, sources: [
    { name: 'rayna_tours', status: 'success', lastSyncedAt: '2026-10-19T06:00:00Z', lastRunAt: null, rows: 10, durationMs: 100, error: null },
  ] },
  queues: { available: true, queues: [{ channel: 'email', available: true, waiting: 0, active: 0, delayed: 0, completed: 1, failed: 0, paused: 0 }] },
  failedSends: { available: true, rows: [] },
};
const UNAVAILABLE = { available: false, reason: 'unavailable' } as const;
const STATUS_DOWN: Status = { dataSources: UNAVAILABLE, queues: UNAVAILABLE, failedSends: UNAVAILABLE };


const TYPICAL: Mapping = {
  overall: { totalMapped: 400, customersWithBookings: 400, totalCustomers: 3200, matchRate: '12.50' },
  coverage: {
    tours: { total: 200, mapped: 50, lastDataAt: '2026-10-20T01:00:00Z' },
    hotels: { total: 0, mapped: 0, lastDataAt: null },
    visas: { total: 8, mapped: 8, lastDataAt: '2026-10-19T01:00:00Z' },
  },
  dataOverview: { unifiedContacts: 12345, travelBookings: 678, chats: 90, totalUsers: 20000, uniqueEmails: 11000, phones: 9000, tours: 200, hotels: 0, visas: 8 },
  mysqlStatus: [{ table_name: 'wa_chats', rows_synced: 1500, sync_duration_ms: 2500, last_synced_at: '2026-10-18T10:00:00Z' }],
  cronJobs: [
    {
      name: 'nightly_snapshot', label: 'Nightly Snapshot', category: 'compute', schedule: '0 2 * * *', humanSchedule: 'Daily at 2 AM',
      description: 'Builds snapshots.', nextRun: '2026-10-20T02:00:00Z',
      meta: { sync_status: 'error', error_message: 'connection timeout', rows_synced: 10, sync_duration_ms: 1200, last_synced_at: '2026-10-19T02:00:00Z' },
    },
    {
      name: 'chats_sync', label: 'Chats Sync', category: 'ingest', schedule: '30 3 * * *', humanSchedule: 'Daily at 3:30 AM Dubai',
      description: 'Pulls chats.', nextRun: '2026-10-20T03:30:00Z', meta: { last_synced_at: '2026-10-19T03:30:00Z', rows_synced: 40, sync_duration_ms: 500 },
      sourceLatestAt: '2026-10-19T03:00:00Z', sourceLabel: 'phpAdmin',
    },
    { name: 'journey_engine', label: 'Journey Engine', category: 'engine', schedule: '*/5 * * * *', humanSchedule: 'Every 5 minutes', meta: null, nextRun: '2026-10-20T00:05:00Z' },
  ],
  computedAt: '2026-10-20T00:00:00Z',
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><DataPipeline /></BusinessTypeProvider>);

describe('Data Pipeline page', () => {
  it('renders the figures, bookings by product and the job table from typical data', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue(TYPICAL);
    renderPage();
    await screen.findByText('Data pipeline');
    await screen.findByText('What we hold');
    // Tiles
    expect(screen.getByText('12,345')).toBeTruthy();
    expect(screen.getByText('B2C contacts')).toBeTruthy();
    expect(bodyText()).toContain('of 20,000 in total');
    expect(screen.getByText('11,000')).toBeTruthy();
    expect(screen.getByText('9,000')).toBeTruthy();
    expect(bodyText()).toContain('400 contacts have booked');
    // Bookings by product: hotels (0 rows) is hidden, tours and visas shown with linked %
    expect(bodyText()).toContain('400 of 3,200 contacts have at least one booking (12.5%)');
    expect(screen.getByText('Tours')).toBeTruthy();
    expect(screen.getByText('Visas')).toBeTruthy();
    expect(screen.queryByText('Hotels')).toBeNull();
    expect(bodyText()).toContain('25.0%');
    expect(bodyText()).toContain('100.0%');
    // Jobs, grouped, with error text and last-run details
    expect(screen.getByText('Scheduled jobs')).toBeTruthy();
    expect(bodyText()).toContain('3 jobs');
    expect(screen.getByText('Bringing data in')).toBeTruthy();
    expect(screen.getByText('Nightly calculations')).toBeTruthy();
    expect(screen.getByText('Always running')).toBeTruthy();
    expect(screen.getByText('Nightly Snapshot')).toBeTruthy();
    expect(screen.getByText('connection timeout')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(bodyText()).toContain('10 rows · 1.2s');
    expect(bodyText()).toContain('40 rows · 0.5s');
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(bodyText()).toContain('source:');
    // Old sections are gone
    expect(screen.queryByText('Chats Sync')).not.toBeNull(); // the job row, not the old card
    expect(screen.queryByText('Match Method')).toBeNull();
    expect(screen.queryByText('Data Sources Overview')).toBeNull();
    expect(bodyText()).toContain('Figures as of');
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('undefined');
  });

  it('hides every section for an empty payload instead of showing zeros', async () => {
    renderPage();
    await screen.findByText('Data pipeline');
    await waitFor(() => expect(screen.queryByTestId('pipeline-skeleton')).toBeNull());
    expect(screen.queryByText('What we hold')).toBeNull();
    expect(screen.queryByText('Bookings by product')).toBeNull();
    expect(screen.queryByText('Scheduled jobs')).toBeNull();
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('undefined');
  });

  it('shows a loader (with the heading) while loading', async () => {
    vi.mocked(api.getMappingStats).mockReturnValue(new Promise<Mapping>(() => {}));
    renderPage();
    await waitFor(() => expect(api.getMappingStats).toHaveBeenCalled());
    expect(screen.getByTestId('pipeline-skeleton')).toBeTruthy();
    expect(screen.getByText('Data pipeline')).toBeTruthy();
    expect(screen.queryByText('What we hold')).toBeNull();
  });

  it('shows an error with a retry that bypasses the server cache', async () => {
    vi.mocked(api.getMappingStats).mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(TYPICAL);
    renderPage();
    await screen.findByText('Pipeline figures unavailable');
    expect(console.error).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Try again'));
    await screen.findByText('What we hold');
    expect(api.getMappingStats).toHaveBeenLastCalledWith({ businessType: 'B2C' }, { fresh: true });
  });

  it('shows the stale note when the server answered from an old cache', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue({ ...TYPICAL, stale: true });
    renderPage();
    await screen.findByText('Refreshing in the background');
  });

  it('Refresh asks for fresh figures and re-checks the status center', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue(TYPICAL);
    renderPage();
    await screen.findByText('What we hold');
    const statusCalls = vi.mocked(api.getOverviewStatus).mock.calls.length;
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(api.getMappingStats).toHaveBeenLastCalledWith({ businessType: 'B2C' }, { fresh: true }));
    await waitFor(() => expect(vi.mocked(api.getOverviewStatus).mock.calls.length).toBe(statusCalls + 1));
  });

  it('sends the business type filter (B2C by default, none for All) and labels the tiles', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue(TYPICAL);
    const first = renderPage();
    await screen.findByText('B2C contacts');
    expect(api.getMappingStats).toHaveBeenCalledWith({ businessType: 'B2C' }, {});
    first.unmount();
    vi.mocked(api.getMappingStats).mockClear();
    localStorage.setItem('business-type', 'All');
    renderPage();
    await waitFor(() => expect(api.getMappingStats).toHaveBeenCalledWith({}, {}));
    await screen.findByText('All contacts');
    expect(bodyText()).not.toContain('in total');
  });

  it('never calls the sync or rebuild endpoints', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue(TYPICAL);
    renderPage();
    await screen.findByText('What we hold');
    fireEvent.click(screen.getByText('Refresh'));
    expect(api.getRaynaSyncStatus).not.toHaveBeenCalled();
    expect(api.triggerRaynaSync).not.toHaveBeenCalled();
    expect(api.triggerRaynaSyncEndpoint).not.toHaveBeenCalled();
    expect(api.refreshBookingMapping).not.toHaveBeenCalled();
  });

  describe('Status center', () => {
    it('renders data sources, queue cards and failed sends from real status data', async () => {
      vi.mocked(api.getOverviewStatus).mockResolvedValue(STATUS_OK);
      renderPage();
      await screen.findByText('rayna_tours');
      expect(screen.getByTestId('overall-health').textContent).toContain('3 issues need attention');
      expect(screen.getByText('Healthy')).toBeTruthy();
      expect(screen.getByText('Error')).toBeTruthy();
      expect(screen.getByText('bigquery quota exceeded')).toBeTruthy();
      expect(bodyText()).toContain('4,321');
      expect(bodyText()).toContain('3.4s');
      const email = screen.getByTestId('queue-email');
      expect(within(email).getByText('Processing')).toBeTruthy();
      expect(email.textContent).toContain('12waiting');
      expect(within(screen.getByTestId('queue-whatsapp')).getByText('3 failed')).toBeTruthy();
      // A channel the queue backend could not report is left out rather than shown empty.
      expect(screen.queryByTestId('queue-sms')).toBeNull();
      expect(screen.getByText('Message template is not approved')).toBeTruthy();
      expect(screen.getByText('+971500000000')).toBeTruthy();
      const logLinks = Array.from(document.querySelectorAll('a[href="/log"]'));
      expect(logLinks.length).toBeGreaterThanOrEqual(2);
      expect(bodyText()).not.toContain('NaN');
      expect(bodyText()).not.toContain('undefined');
    });

    it('shows a healthy chip when every section reports and nothing failed', async () => {
      vi.mocked(api.getOverviewStatus).mockResolvedValue(STATUS_HEALTHY);
      renderPage();
      await waitFor(() => expect(screen.getByTestId('overall-health').textContent).toBe('All systems healthy'));
      // Nothing failed → no "Failed sends" card at all.
      expect(screen.queryByText('Failed sends (last 24h)')).toBeNull();
      expect(bodyText()).toContain('Failed sends (24h) 0');
      expect(within(screen.getByTestId('queue-email')).getByText('Idle')).toBeTruthy();
    });

    it('hides unavailable sections and never fakes values', async () => {
      vi.mocked(api.getOverviewStatus).mockResolvedValue(STATUS_DOWN);
      renderPage();
      await waitFor(() => expect(screen.getByTestId('overall-health').textContent).toBe('Status unknown'));
      expect(screen.queryByText('Not available right now')).toBeNull();
      expect(screen.queryByText('Data sources')).toBeNull();
      expect(screen.queryByText('Queue health')).toBeNull();
      expect(screen.queryByText('Failed sends (last 24h)')).toBeNull();
      expect(screen.queryByTestId('queue-email')).toBeNull();
      expect(bodyText()).toContain('Failed sends (24h) --');
      expect(bodyText()).not.toContain('NaN');
    });

    it("shows the \"Can't reach the server\" banner when the status request fails", async () => {
      vi.mocked(api.getOverviewStatus).mockRejectedValue(new TypeError('Failed to fetch'));
      renderPage();
      await screen.findByText(/Can't reach the server/);
      expect(screen.queryByText('Queue health')).toBeNull();
      expect(bodyText()).not.toContain('NaN');
    });

    it('polls every 30s, clears the banner on recovery and stops on unmount', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(api.getOverviewStatus).mockRejectedValueOnce(new Error('down')).mockResolvedValue(STATUS_OK);
        const view = renderPage();
        await screen.findByText(/Can't reach the server/);
        const calls = vi.mocked(api.getOverviewStatus).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(vi.mocked(api.getOverviewStatus).mock.calls.length).toBe(calls + 1);
        await waitFor(() => expect(screen.queryByText(/Can't reach the server/)).toBeNull());
        expect(screen.getByText('rayna_tours')).toBeTruthy();
        view.unmount();
        const after = vi.mocked(api.getOverviewStatus).mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(vi.mocked(api.getOverviewStatus).mock.calls.length).toBe(after);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
