// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import SegmentActivity from '@/app/(dashboard)/segment-activity/page';

vi.mock('@/lib/api');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/segment-activity',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type ActRes = Awaited<ReturnType<typeof api.getSegmentActivity>>;
type ChRes = Awaited<ReturnType<typeof api.getSegmentChanges>>;

const activity = {
  liveToday: [
    { segment_label: 'ON_TRIP', total_count: 1200, revenue: 50000 },
    { segment_label: 'ODD_SEG', total_count: undefined, revenue: undefined },
  ],
  logs: [
    { log_date: '2026-10-18T00:00:00Z', segment_label: 'ON_TRIP', total_count: 1200, entered: 30, exited: 5, converted: 2, emails_sent: 10, whatsapp_sent: 4, push_sent: 1, total_reached: 15, journey_active: 3, revenue: 999 },
    { log_date: '2026-10-18T00:00:00Z', segment_label: 'PROSPECT', entered: 0, exited: 0, converted: 0 },
    { log_date: '2026-10-17T00:00:00Z', segment_label: 'CANCELLED', entered: 1, exited: 2, converted: 0, total_reached: 5 },
  ],
};
const changes = { before: { date: '2026-10-17' }, after: { date: '2026-10-18' }, changes: [
  { segment: 'ON_TRIP', before: 100, after: 120, change: 20 },
  { segment: 'PROSPECT', before: 50, after: 40, change: -10 },
  { segment: 'NEW_ONE', before: 5, after: 5, change: 0 },
] };

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><SegmentActivity /></BusinessTypeProvider>);

describe('Segment activity page', () => {
  it('renders KPIs, live counts, changes and the daily log', async () => {
    vi.mocked(api.getSegmentActivity).mockResolvedValue(activity as unknown as ActRes);
    vi.mocked(api.getSegmentChanges).mockResolvedValue(changes as unknown as ChRes);
    renderPage();
    await screen.findByText('Daily Log');
    expect(screen.getAllByText((1200).toLocaleString()).length).toBeGreaterThan(0);
    expect(screen.getAllByText('AED 50,000').length).toBeGreaterThan(0);
    expect(screen.getByText('ODD_SEG')).toBeTruthy();
    expect(screen.getByText('+30')).toBeTruthy();
    expect(screen.getByText('-5')).toBeTruthy();
    expect(screen.getByText('18 Oct 2026')).toBeTruthy();
    expect(screen.getByText('17 Oct 2026')).toBeTruthy();
    await screen.findByText('Segment Changes');
    expect(screen.getByText('2026-10-17 → 2026-10-18')).toBeTruthy();
    expect(screen.getByText('+20')).toBeTruthy();
    expect(screen.getByText('-10')).toBeTruthy();
    expect(screen.getByText('NEW_ONE')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(api.getSegmentActivity).toHaveBeenCalledWith({ days: 2, businessType: 'B2C' });
  });

  it('loading state hides KPI cards', () => {
    vi.mocked(api.getSegmentActivity).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.queryByText('Total Customers')).toBeNull();
    expect(screen.queryByText('Daily Log')).toBeNull();
  });

  it('empty data shows the empty log message and zero KPIs', async () => {
    renderPage();
    await screen.findByText(/No daily logs yet/);
    expect(screen.getByText('AED 0')).toBeTruthy();
    expect(screen.queryByText('Segment Changes')).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API errors do not crash', async () => {
    vi.mocked(api.getSegmentActivity).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getSegmentChanges).mockRejectedValue(new Error('HTTP 500'));
    renderPage();
    await screen.findByText(/No daily logs yet/);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('days and segment filters refetch with right params', async () => {
    renderPage();
    await screen.findByText('Daily Log');
    const [daysSel, segSel] = screen.getAllByRole('combobox');
    fireEvent.change(daysSel, { target: { value: '30' } });
    await waitFor(() => expect(api.getSegmentActivity).toHaveBeenLastCalledWith({ days: 30, businessType: 'B2C' }));
    fireEvent.change(segSel, { target: { value: 'CANCELLED' } });
    await waitFor(() => expect(api.getSegmentActivity).toHaveBeenLastCalledWith({ days: 30, businessType: 'B2C', segment: 'CANCELLED' }));
  });

  it('Download CSV / Export call downloadSegmentActivity with current filters', async () => {
    renderPage();
    await screen.findByText('Daily Log');
    fireEvent.click(screen.getByText('Download CSV'));
    expect(api.downloadSegmentActivity).toHaveBeenCalledWith({ days: 2, segment: '', businessType: 'B2C' });
    fireEvent.click(screen.getByText('Export'));
    expect(api.downloadSegmentActivity).toHaveBeenCalledTimes(2);
  });

  it('Snapshot Now snapshots, reloads and refetches changes', async () => {
    renderPage();
    await screen.findByText('Daily Log');
    fireEvent.click(screen.getByText('Snapshot Now'));
    await waitFor(() => expect(api.snapshotDailySegments).toHaveBeenCalled());
    await waitFor(() => expect(api.getSegmentActivity).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getSegmentChanges).toHaveBeenCalledTimes(2));
  });

  it('Snapshot failure does not crash', async () => {
    vi.mocked(api.snapshotDailySegments).mockRejectedValue(new Error('x'));
    renderPage();
    await screen.findByText('Daily Log');
    fireEvent.click(screen.getByText('Snapshot Now'));
    await waitFor(() => expect(api.snapshotDailySegments).toHaveBeenCalled());
    expect(api.getSegmentActivity).toHaveBeenCalledTimes(1);
  });

  it('log Refresh replaces only the logs', async () => {
    vi.mocked(api.getSegmentActivity).mockResolvedValueOnce(activity as unknown as ActRes)
      .mockResolvedValueOnce({ logs: [] } as unknown as ActRes);
    renderPage();
    await screen.findByText('+30');
    fireEvent.click(screen.getByText('Refresh'));
    await screen.findByText(/No daily logs yet/);
    expect(screen.getByText('ODD_SEG')).toBeTruthy();
  });

  it('clicking a live segment requests its customers', async () => {
    vi.mocked(api.getSegmentActivity).mockResolvedValue(activity as unknown as ActRes);
    renderPage();
    fireEvent.click(await screen.findByText('ODD_SEG'));
    await waitFor(() => expect(api.getSegmentCustomers).toHaveBeenCalledWith({ bookingStatus: 'ODD_SEG', businessType: 'B2C', page: 1, limit: 25 }));
  });

  // BUG: segment-activity/page.tsx:111 fmtAED calls (n || 0).toLocaleString(...) directly;
  // when the API returns revenue as a numeric string (Postgres numeric), String#toLocaleString
  // ignores the options, so "AED 12345.6" is shown instead of "AED 12,346".
  it('string revenue is formatted with grouping and no decimals', async () => {
    vi.mocked(api.getSegmentActivity).mockResolvedValue({
      liveToday: [], logs: [{ log_date: '2026-10-18', segment_label: 'ON_TRIP', entered: 0, exited: 0, converted: 0, revenue: '12345.6' }],
    } as unknown as ActRes);
    renderPage();
    await screen.findByText('Daily Log');
    await screen.findByText('AED 12,346', {}, { timeout: 300 });
  });

  // BUG: segment-activity/page.tsx:174 openDetail fetches segment customers, but the
  // panel that renders them (page.tsx:447-531) is commented out, so clicking a segment
  // (as the header text instructs) shows nothing.
  it.fails('clicking a segment shows its customers', async () => {
    vi.mocked(api.getSegmentActivity).mockResolvedValue(activity as unknown as ActRes);
    vi.mocked(api.getSegmentCustomers).mockResolvedValue({ data: [{ id: 1, name: 'Carl' }], total: 1, totalPages: 1 });
    renderPage();
    fireEvent.click(await screen.findByText('ODD_SEG'));
    await screen.findByText('Carl', {}, { timeout: 300 });
  });
});
