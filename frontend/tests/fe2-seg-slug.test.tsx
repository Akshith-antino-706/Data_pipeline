// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import SegmentDetailPage from '@/app/(dashboard)/segmentation/[slug]/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ params: { slug: 'future-travel-luxury-local' } as Record<string, string> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => nav.params,
  usePathname: () => '/segmentation/x',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

class RO { observe() {} unobserve() {} disconnect() {} }

type CustRes = Awaited<ReturnType<typeof api.getSegmentCustomers>>;
type ContactRes = Awaited<ReturnType<typeof api.getUnifiedContact>>;

const customers = {
  total: 60, totalPages: 3,
  data: [
    { id: 11, name: 'Alice Smith', email: 'alice@x.com', phone: '+971', is_indian: true, total_tour_bookings: 2, total_hotel_bookings: 0, total_visa_bookings: 1, total_flight_bookings: 0, total_chats: 3, total_booking_revenue: '1500.5' },
    { id: 12, name: null, email: null, phone: null, is_indian: false, total_tour_bookings: 0, total_hotel_bookings: 0, total_visa_bookings: 0, total_flight_bookings: 0, total_chats: 0, total_booking_revenue: 'garbage' },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.params = { slug: 'future-travel-luxury-local' };
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><SegmentDetailPage /></BusinessTypeProvider>);

describe('Segment slug detail page', () => {
  it('renders header, badges, KPIs and customers', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    renderPage();
    await screen.findByText('Alice Smith');
    expect(screen.getAllByText(/Future Travel/).length).toBeGreaterThan(0);
    expect(screen.getByText('Luxury')).toBeTruthy();
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.getByText('60 customers')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText('Indian')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(api.getSegmentCustomers).toHaveBeenCalledWith(expect.objectContaining({
      page: 1, limit: 25, bookingStatus: 'FUTURE_TRAVEL', productTier: 'LUXURY', geography: 'LOCAL',
    }));
  });

  it('loading state shows table-row skeletons, not a spinner or "Loading..." text', () => {
    vi.mocked(api.getSegmentCustomers).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(screen.getByLabelText('Loading customers')).toBeTruthy();
    expect(container.querySelectorAll('.ui-skel').length).toBeGreaterThan(10);
    expect(container.querySelector('.spin')).toBeNull();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('empty data shows "No customers found"', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue({ total: 0, totalPages: 0, data: [] } as unknown as CustRes);
    renderPage();
    await screen.findByText('No customers found');
    expect(screen.getByText('0 customers')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('empty {} response renders without NaN/undefined', async () => {
    renderPage();
    await screen.findByText('No customers found');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API error does not crash', async () => {
    vi.mocked(api.getSegmentCustomers).mockRejectedValue(new Error('HTTP 500'));
    renderPage();
    await screen.findByText('No customers found');
  });

  it('general slug omits bookingStatus', async () => {
    nav.params = { slug: 'general-standard-international' };
    renderPage();
    await waitFor(() => expect(api.getSegmentCustomers).toHaveBeenCalled());
    const args = vi.mocked(api.getSegmentCustomers).mock.calls[0][0];
    expect(args).toMatchObject({ productTier: 'STANDARD', geography: 'INTERNATIONAL' });
    expect(args).not.toHaveProperty('bookingStatus');
    expect(screen.getByText('Standard')).toBeTruthy();
    expect(screen.getByText('International')).toBeTruthy();
  });

  it('search on Enter and pagination call api with right args', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    renderPage();
    await screen.findByText('Alice Smith');
    const input = screen.getByPlaceholderText('Search name, email, phone...');
    fireEvent.change(input, { target: { value: 'ali' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.getSegmentCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'ali' })));
    await screen.findByText('Alice Smith');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(api.getSegmentCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, search: 'ali' })));
    await screen.findByText('Page 2 of 3');
    fireEvent.click(screen.getByText('Prev'));
    await waitFor(() => expect(api.getSegmentCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })));
  });

  it('eye button opens user detail modal with bookings and expands', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    vi.mocked(api.getUnifiedContact).mockResolvedValue({ data: {
      name: 'Alice Smith Full', email: 'af@x.com', mobile: '555', country: 'UAE', booking_status: 'ON_TRIP', contact_type: 'B2C',
      product_tier: 'LUXURY', total_booking_revenue: '2500', total_tour_bookings: 2,
      rayna_tours: [
        { service_name: 'Desert Safari', selling_price: '100', travel_date: '2026-10-10T00:00:00Z', booking_date: '2026-10-01' },
        { selling_price: '0', bill_no: 77, is_cancel: '1' },
      ],
    } } as unknown as ContactRes);
    renderPage();
    await screen.findByText('Alice Smith');
    fireEvent.click(screen.getAllByTitle('View user details')[0]);
    await screen.findByText('Alice Smith Full');
    expect(api.getUnifiedContact).toHaveBeenCalledWith(11);
    expect(screen.getByText('On Trip')).toBeTruthy();
    expect(screen.getByText('AED 2,500.00')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Tours')[0]);
    await screen.findByText('Desert Safari');
    expect(screen.getByText('Booking #77')).toBeTruthy();
    expect(screen.getByText('CANCELLED')).toBeTruthy();
    expect(screen.getByText('Travel: 2026-10-10')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  // BUG: [slug]/page.tsx:64 fmtAED does Number(n || 0); a non-numeric selling_price
  // string like 'abc' is truthy, so Number('abc') renders "AED NaN" in the booking list.
  it('non-numeric booking selling_price renders without NaN', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    vi.mocked(api.getUnifiedContact).mockResolvedValue({ data: {
      name: 'Bad Price', total_tour_bookings: 1, rayna_tours: [{ service_name: 'Odd', selling_price: 'abc' }],
    } } as unknown as ContactRes);
    renderPage();
    await screen.findByText('Alice Smith');
    fireEvent.click(screen.getAllByTitle('View user details')[0]);
    await screen.findByText('Bad Price');
    fireEvent.click(screen.getAllByText('Tours')[0]);
    await screen.findByText('Odd');
    expect(bodyText()).not.toContain('NaN');
  });

  it('user detail error does not crash', async () => {
    vi.mocked(api.getSegmentCustomers).mockResolvedValue(customers as unknown as CustRes);
    vi.mocked(api.getUnifiedContact).mockRejectedValue(new Error('404'));
    renderPage();
    await screen.findByText('Alice Smith');
    fireEvent.click(screen.getAllByTitle('View user details')[1]);
    await waitFor(() => expect(api.getUnifiedContact).toHaveBeenCalledWith(12));
    expect(screen.getByText('Alice Smith')).toBeTruthy();
  });
});
