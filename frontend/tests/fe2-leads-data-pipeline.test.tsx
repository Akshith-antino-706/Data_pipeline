// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
});
