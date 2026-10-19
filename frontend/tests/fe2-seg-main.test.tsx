// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import CustomerSegmentation from '@/app/(dashboard)/segmentation/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/segmentation',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn<(m: string) => void>(), error: vi.fn<(m: string) => void>() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

class RO { observe() {} unobserve() {} disconnect() {} }

type TreeRes = Awaited<ReturnType<typeof api.getSegmentationTree>>;
type GenRes = Awaited<ReturnType<typeof api.getGeneralSegment>>;
type CustomRes = Awaited<ReturnType<typeof api.getCustomSegments>>;

const tree = {
  totals: { total: 1000, segmented: 800, segment_count: 12 },
  statusCounts: [
    { booking_status: 'ON_TRIP', count: 300, revenue: '45000.5', total_bookings: 50, booking_breakdown: { tours: 30, tours_revenue: '20000', hotels: 20, hotels_revenue: 'bad' } },
    { booking_status: 'PROSPECT', count: 500, revenue: 0 },
    { booking_status: 'MYSTERY', count: 0, revenue: null },
  ],
  breakdown: [
    { booking_status: 'ON_TRIP', product_tier: 'LUXURY', geography: 'LOCAL', count: 100, revenue: '5000', indian_count: 4, total_tours: 1, total_hotels: 2, total_visas: 3, total_flights: 4 },
    { booking_status: 'PROSPECT', product_tier: 'LUXURY', geography: 'LOCAL', count: '50', revenue: 'x', indian_count: 0, total_tours: 0, total_hotels: 0, total_visas: 0, total_flights: 0 },
    { booking_status: 'ON_TRIP', product_tier: 'STANDARD', geography: 'INTERNATIONAL', count: 200, revenue: 0, indian_count: 0, total_tours: 0, total_hotels: 0, total_visas: 0, total_flights: 0 },
  ],
  revenueByType: { total: 2500000, sources: [{ source: 'tours', bookings: 10, revenue: 1500000 }, { source: 'cruise', bookings: 1, revenue: 1000000 }] },
};
const general = { data: { totalContacts: 900, emailEligible: 700, waEligible: 600 } };
const customSegs = { data: [
  { id: 5, name: 'My Custom', conditions: [{ field: 'a_b' }, { field: 'c' }, { field: 'd' }, { field: 'e' }], cached_count: 42, created_at: '2026-01-01' },
  { id: 6, name: 'Single', conditions: [{ field: 'x' }], cached_count: null, created_at: '2026-01-01' },
] };

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><CustomerSegmentation /></BusinessTypeProvider>);
const withData = () => {
  vi.mocked(api.getSegmentationTree).mockResolvedValue(tree as unknown as TreeRes);
  vi.mocked(api.getGeneralSegment).mockResolvedValue(general as unknown as GenRes);
  vi.mocked(api.getCustomSegments).mockResolvedValue(customSegs as unknown as CustomRes);
};

describe('Segmentation overview page', () => {
  it('renders KPIs, revenue sources, status cards, general card and custom segments', async () => {
    withData();
    renderPage();
    await screen.findByText('Total Customers');
    expect(screen.getByText((1000).toLocaleString())).toBeTruthy();
    expect(screen.getByText(`${(800).toLocaleString()} (80.0%)`)).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('AED 2.50M')).toBeTruthy();
    expect(screen.getByText('cruise')).toBeTruthy();
    expect(screen.getAllByText('On Trip').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MYSTERY').length).toBeGreaterThan(0);
    await screen.findByText('General');
    expect(screen.getByText(/700 email/)).toBeTruthy();
    await screen.findByText('My Custom');
    expect(screen.getByText('4 conditions')).toBeTruthy();
    expect(screen.getByText('1 condition')).toBeTruthy();
    expect(screen.getByText('+1 more')).toBeTruthy();
    expect(screen.getByText('a b')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('loading state shows skeletons and disables Refresh', () => {
    vi.mocked(api.getSegmentationTree).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getGeneralSegment).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.queryByText('Total Customers')).toBeNull();
    expect((screen.getByText('Refresh').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty data renders zeroes without NaN/undefined', async () => {
    renderPage();
    await screen.findByText('Total Customers');
    expect(screen.getByText('0 (0%)')).toBeTruthy();
    expect(screen.getByText('AED 0.00M')).toBeTruthy();
    expect(screen.queryByText('General')).toBeNull();
    expect(screen.queryByText('Custom Segments')).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API errors do not crash', async () => {
    vi.mocked(api.getSegmentationTree).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getGeneralSegment).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getCustomSegments).mockRejectedValue(new Error('HTTP 500'));
    renderPage();
    await screen.findByText('Total Customers');
    expect(screen.getByText('Status Distribution')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('expanding a status card shows its breakdown and navigates to the combo slug', async () => {
    withData();
    renderPage();
    await screen.findByText('Total Customers');
    fireEvent.click(screen.getAllByText('On Trip')[0]);
    await screen.findByText(/On Trip Breakdown/);
    expect(screen.queryByText('Status Distribution')).toBeNull();
    expect(screen.getByText('4 Indian')).toBeTruthy();
    fireEvent.click(screen.getByText('On Trip — Luxury — Local'));
    expect(nav.push).toHaveBeenCalledWith('/segmentation/on-trip-luxury-local');
  });

  it('General card aggregates breakdown across statuses and navigates without status', async () => {
    withData();
    renderPage();
    fireEvent.click(await screen.findByText('General'));
    await screen.findByText(/General Breakdown/);
    // ON_TRIP 100 + PROSPECT '50' => 150 for LUXURY|LOCAL
    expect(screen.getByText('150')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    fireEvent.click(screen.getByText('General — Luxury — Local'));
    expect(nav.push).toHaveBeenCalledWith('/segmentation/general-luxury-local');
  });

  it('booking breakdown modal opens with per-type rows', async () => {
    withData();
    renderPage();
    await screen.findByText('Total Customers');
    fireEvent.click(screen.getByTitle('View booking breakdown'));
    await screen.findByText('Booking Breakdown');
    expect(screen.getByText('60.0%')).toBeTruthy();
    expect(screen.getByText('40.0%')).toBeTruthy();
    expect(screen.getAllByText('AED 20,000.00').length).toBeGreaterThan(0);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('Refresh recomputes, refreshes snapshot, then reloads', async () => {
    withData();
    renderPage();
    await screen.findByText('Total Customers');
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(api.refreshSegmentationSnapshot).toHaveBeenCalled());
    expect(api.recomputeSegmentation).toHaveBeenCalled();
    await waitFor(() => expect(api.getSegmentationTree).toHaveBeenCalledTimes(2));
    expect(api.getSegmentationTree).toHaveBeenCalledWith({ businessType: 'B2C' });
  });

  it('Refresh failure does not reload or crash', async () => {
    withData();
    vi.mocked(api.recomputeSegmentation).mockRejectedValue(new Error('timeout'));
    renderPage();
    await screen.findByText('Total Customers');
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect((screen.getByText('Refresh').closest('button') as HTMLButtonElement).disabled).toBe(false));
    expect(api.refreshSegmentationSnapshot).not.toHaveBeenCalled();
    expect(api.getSegmentationTree).toHaveBeenCalledTimes(1);
  });

  it('header buttons navigate / open create modal', async () => {
    renderPage();
    await screen.findByText('Total Customers');
    fireEvent.click(screen.getByText('All Segments'));
    expect(nav.push).toHaveBeenCalledWith('/segmentation/all-segments');
    fireEvent.click(screen.getByText('Create Segment'));
    await screen.findByText('Create Custom Segment');
  });

  it('custom segment click navigates; delete confirms then calls api', async () => {
    withData();
    renderPage();
    fireEvent.click(await screen.findByText('My Custom'));
    expect(nav.push).toHaveBeenCalledWith('/segmentation/custom/5');
    fireEvent.click(screen.getAllByTitle('Delete segment')[1]);
    await screen.findByText('Delete Segment');
    fireEvent.click(screen.getByText('Cancel'));
    expect(api.deleteCustomSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTitle('Delete segment')[1]);
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(api.deleteCustomSegment).toHaveBeenCalledWith(6));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Segment deleted'));
  });

  it('delete failure toasts error', async () => {
    withData();
    vi.mocked(api.deleteCustomSegment).mockRejectedValue(new Error('x'));
    renderPage();
    await screen.findByText('My Custom');
    fireEvent.click(screen.getAllByTitle('Delete segment')[0]);
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to delete segment'));
  });

  it('passes businessType from context to the tree API', async () => {
    localStorage.setItem('business-type', 'B2B');
    renderPage();
    await waitFor(() => expect(api.getSegmentationTree).toHaveBeenCalledWith({ businessType: 'B2B' }));
  });

  // BUG: segmentation/page.tsx:51 pct() does (n / total) with n undefined when the API
  // omits totals.segmented, rendering "NaN%" in the Segmented KPI.
  it.fails('missing totals.segmented does not render NaN', async () => {
    vi.mocked(api.getSegmentationTree).mockResolvedValue({ totals: { total: 10 } } as unknown as TreeRes);
    renderPage();
    await screen.findByText('Total Customers');
    expect(bodyText()).not.toContain('NaN');
  });
});
