// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import CustomSegmentDetailPage from '@/app/(dashboard)/segmentation/custom/[id]/page';

vi.mock('@/lib/api');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({ id: '7' }),
  usePathname: () => '/segmentation/custom/7',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

class RO { observe() {} unobserve() {} disconnect() {} }

type SegRes = Awaited<ReturnType<typeof api.getCustomSegmentById>>;
type CustRes = Awaited<ReturnType<typeof api.getCustomSegmentCustomers>>;
type ContactRes = Awaited<ReturnType<typeof api.getUnifiedContact>>;

const segment = { data: {
  name: 'VIP Dubai', description: 'Top customers', color: '#ff00aa',
  conditions: [{ field: 'booking_status', value: 'ON_TRIP' }, { field: 'country', value: ['UAE', 'IN'] }, { field: 'has_email' }],
} };
const customers = {
  total: 40, totalPages: 2,
  data: [
    { id: 1, name: 'Bob', email: 'bob@x.com', mobile: '123', country: 'UAE', city: 'Dubai', is_indian: true, booking_status: 'ON_TRIP', product_tier: 'LUXURY', geography: 'LOCAL' },
    { id: 2, booking_status: 'WEIRD_STATUS', geography: 'INTERNATIONAL', country: 'IN' },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><CustomSegmentDetailPage /></BusinessTypeProvider>);

describe('Custom segment detail page', () => {
  it('renders segment header, conditions, KPIs and customers', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue(segment as unknown as SegRes);
    vi.mocked(api.getCustomSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    render(<CustomSegmentDetailPage />);
    await screen.findByText('Bob');
    expect(screen.getAllByText('VIP Dubai').length).toBeGreaterThan(0);
    expect(screen.getByText('Top customers')).toBeTruthy();
    expect(screen.getByText('booking status: ON_TRIP')).toBeTruthy();
    expect(screen.getByText('country: UAE, IN')).toBeTruthy();
    expect(screen.getByText('has email')).toBeTruthy();
    expect(screen.getByText('40 customers')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('On Trip')).toBeTruthy();
    expect(screen.getByText('WEIRD_STATUS')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText(/UAE · Dubai/)).toBeTruthy();
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(api.getCustomSegmentById).toHaveBeenCalledWith('7');
    expect(api.getCustomSegmentCustomers).toHaveBeenCalledWith('7', { page: 1, limit: 25 });
  });

  it('loading state shows spinner only', () => {
    vi.mocked(api.getCustomSegmentById).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.spin')).toBeTruthy();
    expect(screen.queryByText('Segment not found')).toBeNull();
  });

  it('segment API error shows "Segment not found"', async () => {
    vi.mocked(api.getCustomSegmentById).mockRejectedValue(new Error('HTTP 404'));
    renderPage();
    await screen.findByText('Segment not found');
    expect(screen.getByText('Back to Segmentation')).toBeTruthy();
  });

  it('empty customers shows "No customers found" without NaN/undefined', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue({ data: { name: 'Empty' } } as unknown as SegRes);
    vi.mocked(api.getCustomSegmentCustomers).mockResolvedValue({ data: [], total: 0 } as unknown as CustRes);
    renderPage();
    await screen.findByText('No customers found');
    expect(screen.getByText('0 customers')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('customers API error does not crash', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue(segment as unknown as SegRes);
    vi.mocked(api.getCustomSegmentCustomers).mockRejectedValue(new Error('HTTP 500'));
    renderPage();
    await screen.findByText('No customers found');
  });

  it('search and pagination call api with right args', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue(segment as unknown as SegRes);
    vi.mocked(api.getCustomSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    renderPage();
    await screen.findByText('Bob');
    const input = screen.getByPlaceholderText('Search name, email, phone...');
    fireEvent.change(input, { target: { value: 'bob' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.getCustomSegmentCustomers).toHaveBeenLastCalledWith('7', { page: 1, limit: 25, search: 'bob' }));
    await screen.findByText('Bob');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(api.getCustomSegmentCustomers).toHaveBeenLastCalledWith('7', { page: 2, limit: 25, search: 'bob' }));
    await screen.findByText('Page 2 of 2');
    expect((screen.getByText('Next').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens user detail modal and closes it', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue(segment as unknown as SegRes);
    vi.mocked(api.getCustomSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    vi.mocked(api.getUnifiedContact).mockResolvedValue({ data: {
      name: 'Bob Full', total_hotel_bookings: 1, total_booking_revenue: 900,
      rayna_hotels: [{ guest_name: 'Guest A', selling_price: '900', bill_date: '2026-01-02T10:00:00Z' }],
    } } as unknown as ContactRes);
    renderPage();
    await screen.findByText('Bob');
    fireEvent.click(screen.getAllByTitle('View user details')[0]);
    await screen.findByText('Bob Full');
    expect(api.getUnifiedContact).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getAllByText('Hotels')[0]);
    await screen.findByText('Guest A');
    expect(screen.getByText('Travel: 2026-01-02')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  // BUG: custom/[id]/page.tsx:74 does setSegment(res.data || res); a 200 response of
  // { data: null } (segment deleted) is still truthy, so "Segment not found" is never
  // shown and the header renders with an empty name.
  it('{ data: null } response shows "Segment not found"', async () => {
    vi.mocked(api.getCustomSegmentById).mockResolvedValue({ data: null } as unknown as SegRes);
    renderPage();
    await screen.findByText('Segment not found', {}, { timeout: 300 });
  });
});
