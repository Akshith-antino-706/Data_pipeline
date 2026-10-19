// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, within } from '@testing-library/react';
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
type Sync = Awaited<ReturnType<typeof api.getRaynaSyncStatus>>;
const mapping = (d: unknown): Mapping => d as unknown as Mapping;
const sync = (d: unknown): Sync => d as unknown as Sync;
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


const TYPICAL = {
  overall: { totalMapped: 500, customersWithBookings: 400, matchRate: 12.5 },
  coverage: { tours: { total: 200, mapped: 50 }, hotels: { total: 0, mapped: 0 } },
  breakdown: [{ match_type: 'phone', booking_source: 'tours', matched_bookings: 30, unique_customers: 20 }],
  dataOverview: { unifiedContacts: 12345, travelBookings: 678, chats: 90, totalUsers: 20000, uniqueEmails: 11000, phones: 9000, tours: 100, hotels: 7 },
  mysqlStatus: [{ table_name: 'wa_chats', rows_synced: 1500, sync_duration_ms: 2500, last_synced_at: '2026-10-18T10:00:00Z' }],
  cronJobs: [{
    name: 'nightly_snapshot', label: 'Nightly Snapshot', category: 'compute', schedule: '0 2 * * *', humanSchedule: 'Daily at 2 AM',
    description: 'Builds snapshots.', nextRun: '2026-10-20T02:00:00Z',
    meta: { sync_status: 'error', error_message: 'connection timeout', rows_synced: 10, sync_duration_ms: 1200, last_synced_at: '2026-10-19T02:00:00Z' },
  }],
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
  it('renders KPIs, sync status, cron jobs and mapping from typical data', async () => {
    vi.mocked(api.getRaynaSyncStatus).mockResolvedValue(sync({ tables: [{ table_name: 'rayna_tours', last_synced_at: '2026-10-18T10:00:00Z' }] }));
    vi.mocked(api.getMappingStats).mockResolvedValue(mapping(TYPICAL));
    renderPage();
    await screen.findByText('Data Pipeline');
    expect(screen.getAllByText('12,345').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unified Contacts (B2C)').length).toBe(2);
    expect(bodyText()).toContain('1,500 rows | 2.5s | Last:');
    expect(screen.getByText('wa_chats')).toBeTruthy();
    expect(screen.getByText('Nightly Snapshot')).toBeTruthy();
    expect(screen.getByText('connection timeout')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(bodyText()).toContain('10 rows · 1.2s');
    // registration cron fallback is prepended when the API list lacks it
    expect(screen.getByText('Registration Data Sync')).toBeTruthy();
    expect(bodyText()).toContain('2 scheduled · all times in Asia/Dubai');
    expect(bodyText()).toContain('50 / 200 (25.0%)');
    expect(bodyText()).toContain('0 / 0 (0%)');
    expect(bodyText()).toContain('Matched 500 bookings to 400 customers (12.5% of customer base)');
    expect(bodyText()).toContain('tours (phone)');
    expect(bodyText()).toContain('20 customers');
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('undefined');
  });

  it('does not duplicate the registration cron when the API already returns it', async () => {
    vi.mocked(api.getMappingStats).mockResolvedValue(mapping({
      cronJobs: [{ name: 'registration_data_sync', label: 'Registration Data Sync', schedule: '30 0 * * *', humanSchedule: 'Daily', meta: { last_synced_at: '2026-10-19T00:30:00Z' } }],
    }));
    renderPage();
    await screen.findByText('Data Pipeline');
    expect(screen.getAllByText('Registration Data Sync')).toHaveLength(1);
    expect(bodyText()).toContain('1 scheduled');
    expect(screen.getAllByText('Synced').length).toBeGreaterThan(0);
  });

  it('renders empty states with zeros (no NaN/undefined) for empty payloads', async () => {
    renderPage();
    await screen.findByText('Data Pipeline');
    expect(screen.getByText('No chats sync data yet')).toBeTruthy();
    expect(screen.getByText('No mapping data yet. Run sync first, then refresh mapping.')).toBeTruthy();
    expect(bodyText()).toContain('(0% of customer base)');
    expect(bodyText()).toContain('Not tracked in sync_metadata');
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(bodyText()).not.toContain('NaN');
    expect(bodyText()).not.toContain('undefined');
  });

  it('shows the skeleton while loading', async () => {
    vi.mocked(api.getMappingStats).mockReturnValue(new Promise<Mapping>(() => {}));
    const { container } = renderPage();
    await waitFor(() => expect(api.getMappingStats).toHaveBeenCalled());
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(10);
    expect(screen.queryByText('Data Pipeline')).toBeNull();
  });

  it('survives an API error and renders the page with empty data', async () => {
    vi.mocked(api.getMappingStats).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getRaynaSyncStatus).mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    await screen.findByText('Data Pipeline');
    expect(console.error).toHaveBeenCalled();
    expect(screen.getByText('No chats sync data yet')).toBeTruthy();
    expect(bodyText()).not.toContain('NaN');
  });

  it('sends the business type filter (B2C by default, none for All)', async () => {
    const first = renderPage();
    await screen.findByText('Data Pipeline');
    expect(api.getMappingStats).toHaveBeenCalledWith({ businessType: 'B2C' });
    first.unmount();
    vi.mocked(api.getMappingStats).mockClear();
    localStorage.setItem('business-type', 'All');
    renderPage();
    await waitFor(() => expect(api.getMappingStats).toHaveBeenCalledWith({}));
    await waitFor(() => expect(screen.getAllByText('Unified Contacts (All)')).toHaveLength(2));
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
      expect(within(screen.getByTestId('queue-sms')).getByText('Not available right now')).toBeTruthy();
      expect(screen.getByText('template rejected')).toBeTruthy();
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
      expect(screen.getByText('No failed sends in the last 24 hours')).toBeTruthy();
      expect(within(screen.getByTestId('queue-email')).getByText('Idle')).toBeTruthy();
    });

    it('shows "Not available right now" for unavailable sections and never fakes values', async () => {
      vi.mocked(api.getOverviewStatus).mockResolvedValue(STATUS_DOWN);
      renderPage();
      await waitFor(() => expect(screen.getAllByText('Not available right now')).toHaveLength(3));
      expect(screen.getByTestId('overall-health').textContent).toBe('Status unknown');
      expect(screen.queryByTestId('queue-email')).toBeNull();
      expect(bodyText()).toContain('Failed sends (24h) --');
      expect(bodyText()).not.toContain('NaN');
    });

    it("shows the \"Can't reach the server\" banner when the status request fails", async () => {
      vi.mocked(api.getOverviewStatus).mockRejectedValue(new TypeError('Failed to fetch'));
      renderPage();
      await screen.findByText(/Can't reach the server/);
      expect(screen.getAllByText('Not available right now')).toHaveLength(3);
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

    it('is view-only: renders no sync trigger buttons and never calls sync endpoints', async () => {
      vi.mocked(api.getOverviewStatus).mockResolvedValue(STATUS_OK);
      renderPage();
      await screen.findByText('rayna_tours');
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(api.triggerRaynaSync).not.toHaveBeenCalled();
      expect(api.triggerRaynaSyncEndpoint).not.toHaveBeenCalled();
      expect(api.refreshBookingMapping).not.toHaveBeenCalled();
    });
  });
});
