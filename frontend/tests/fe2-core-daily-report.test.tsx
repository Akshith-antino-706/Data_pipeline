// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import * as api from '@/lib/api';
import DailyReport from '@/app/(dashboard)/daily-report/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.mocked(api.downloadReportCSV).mockResolvedValue(undefined);
  vi.mocked(api.downloadReportAll).mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const today = () => new Date().toISOString().split('T')[0];
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; };
type Counts = Awaited<ReturnType<typeof api.getReportCounts>>;

const COUNTS = {
  totalRows: 1500, totalBills: 12, totalSales: 1234.5, from: '2026-10-01', to: '2026-10-02',
  tables: {
    rayna_tours: { totalRows: 1000, totalBills: 10, totalSales: 1000.25, firstBill: 'B1', lastBill: 'B9', sync: { lastSyncedAt: '2026-10-02T06:00:00Z', syncStatus: 'success' } },
    rayna_hotels: { totalRows: 0, totalBills: 0, totalSales: 0 },
    users: { totalRows: 500, totalBills: null },
  },
};
// Catches render crashes so a known bug fails its assertion instead of becoming an unhandled error.
class Boundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <div>page crashed</div> : this.props.children; }
}

const loadSummary = () => fireEvent.click(screen.getByRole('button', { name: /Load Summary/ }));

describe('Daily report page', () => {
  it('shows the empty prompt and makes no call before Load Summary', () => {
    render(<DailyReport />);
    expect(screen.getByText('Select a date range to get started')).toBeTruthy();
    expect(api.getReportCounts).not.toHaveBeenCalled();
  });

  it('loads and renders counts with typical data', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue(COUNTS as unknown as Counts);
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('Rayna API Bookings');
    expect(api.getReportCounts).toHaveBeenCalledWith(today(), today());
    expect(screen.getByText('1,500')).toBeTruthy();
    expect(screen.getByText('AED 1,234.50')).toBeTruthy();
    expect(screen.getByText('B1 → B9')).toBeTruthy();
    expect(screen.getByText('2026-10-01  to  2026-10-02', { normalizer: s => s })).toBeTruthy();
    expect(screen.getByText('1,000 rows')).toBeTruthy();
    expect(bodyText()).toContain('Synced:');
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.getAllByText('No sync info').length).toBeGreaterThan(0);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('empty counts: zero KPIs and ZIP download disabled', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue({ totalRows: 0, totalBills: 0, totalSales: 0, from: today(), to: today(), tables: {} } as unknown as Counts);
    render(<DailyReport />);
    loadSummary();
    const zip = await screen.findByRole('button', { name: /Download All as ZIP/ });
    expect(zip.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('AED 0.00')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  // BUG: app/(dashboard)/daily-report/page.tsx:242 reads `data.tables[t.key]` without guarding
  // `data.tables`, so a response without `tables` (e.g. `{}` from an empty/odd backend reply)
  // throws a TypeError and unmounts the page instead of rendering zeros.
  it('does not crash when the counts response has no tables', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue({} as unknown as Counts);
    render(<Boundary><DailyReport /></Boundary>);
    loadSummary();
    await screen.findByText('Rayna API Bookings', {}, { timeout: 500 });
  });

  // BUG: app/(dashboard)/daily-report/page.tsx:218 renders `${data.from}  to  ${data.to}`,
  // which shows "undefined  to  undefined" when the API omits from/to.
  it('never shows "undefined" when the counts response omits from/to', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue({ totalRows: 0, tables: {} } as unknown as Counts);
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('Rayna API Bookings');
    expect(bodyText()).not.toContain('undefined');
  });

  it('shows the error message when counts fail', async () => {
    vi.mocked(api.getReportCounts).mockRejectedValue(new Error('HTTP 500 boom'));
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('HTTP 500 boom');
    expect(screen.queryByText('Select a date range to get started')).toBeNull();
  });

  it('shows the loading state while counts are pending', () => {
    vi.mocked(api.getReportCounts).mockReturnValue(new Promise<never>(() => {}));
    render(<DailyReport />);
    loadSummary();
    const btn = screen.getByRole('button', { name: /Loading\.\.\./ });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('Yesterday preset and manual dates are passed to the API', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue(COUNTS as unknown as Counts);
    const { container } = render(<DailyReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    loadSummary();
    await waitFor(() => expect(api.getReportCounts).toHaveBeenCalledWith(yesterday(), yesterday()));
    const [from, to] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    fireEvent.change(to, { target: { value: '2026-09-30' } });
    loadSummary();
    await waitFor(() => expect(api.getReportCounts).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30'));
  });

  it('preview opens a table (null cells as dash), toggles closed, and handles failure', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue(COUNTS as unknown as Counts);
    vi.mocked(api.getReportPreview).mockResolvedValue({ columns: ['bill_no', 'amount'], rows: [{ bill_no: 'B1', amount: 10 }, { bill_no: 'B2', amount: null }], totalRows: 4, previewRows: 2 } as unknown as Awaited<ReturnType<typeof api.getReportPreview>>);
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('Rayna API Bookings');
    const previewBtns = screen.getAllByTitle('Preview the newest rows for cross-checking');
    fireEvent.click(previewBtns[0]);
    await screen.findByText('Preview: Rayna Tours');
    expect(api.getReportPreview).toHaveBeenCalledWith('rayna_tours', today(), today());
    expect(screen.getByText('Newest 2 of 4 rows')).toBeTruthy();
    expect(screen.getByText('B2')).toBeTruthy();
    fireEvent.click(previewBtns[0]);
    await waitFor(() => expect(screen.queryByText('Preview: Rayna Tours')).toBeNull());
    // rayna_hotels has 0 rows -> preview disabled
    expect(previewBtns[1].hasAttribute('disabled')).toBe(true);
    vi.mocked(api.getReportPreview).mockRejectedValue(new Error('nope'));
    fireEvent.click(previewBtns[0]);
    await screen.findByText('Preview failed: nope');
  });

  it('preview with no rows shows the empty message', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue(COUNTS as unknown as Counts);
    vi.mocked(api.getReportPreview).mockResolvedValue({ columns: [], rows: [], totalRows: 0, previewRows: 0 } as unknown as Awaited<ReturnType<typeof api.getReportPreview>>);
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('Rayna API Bookings');
    fireEvent.click(screen.getAllByTitle('Preview the newest rows for cross-checking')[0]);
    await screen.findByText('No data for the selected date range.');
  });

  it('CSV and ZIP downloads call the API and toast success / failure', async () => {
    vi.mocked(api.getReportCounts).mockResolvedValue(COUNTS as unknown as Counts);
    render(<DailyReport />);
    loadSummary();
    await screen.findByText('Rayna API Bookings');
    fireEvent.click(screen.getAllByRole('button', { name: 'Download CSV' })[0]);
    await screen.findByText('Rayna Tours CSV downloaded');
    expect(api.downloadReportCSV).toHaveBeenCalledWith('rayna_tours', today(), today());
    fireEvent.click(screen.getByRole('button', { name: /Download All as ZIP/ }));
    await screen.findByText('ZIP downloaded with all data files');
    expect(api.downloadReportAll).toHaveBeenCalledWith(today(), today());
    vi.mocked(api.downloadReportCSV).mockRejectedValue(new Error('disk full'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Download CSV' })[0]);
    await screen.findByText('Download failed: disk full');
  });
});
