// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import AffinityPage from '@/app/(dashboard)/affinity/page';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/campaigns',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type ApiName = keyof typeof api;
const asMock = (name: ApiName) => vi.mocked(api[name]) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;
const mockOk = (name: ApiName, v: unknown) => asMock(name).mockResolvedValue(v);

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

// Catches a render crash so it fails the assertion instead of surfacing as an unhandled error.
class Boundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <p>page crashed</p> : this.props.children; }
}
const renderPage = () => render(<Boundary><BusinessTypeProvider><AffinityPage /></BusinessTypeProvider></Boundary>);
const lastCall = (name: ApiName): Record<string, unknown> => {
  const calls = asMock(name).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
};

const summary = { builtAt: '2026-10-18T00:30:00Z', status: 'idle', totalCustomers: 120, topService: [{ service: 'tours', customers: 80 }, { service: 'visas', customers: 0 }] };
const customer = {
  unified_id: 5, name: 'Ann', email: 'ann@x.com', mobile: '+971', country: 'UAE', contact_type: 'B2C', is_bulk: true,
  bookings: 4, bookings_all: 9, last_booking_date: '2026-03-12', affinity_score: 0.456,
  service_1: 'tours', service_1_score: 12.34, service_1_bookings: 1,
  product_1_name: 'Desert Safari', product_1_score: 8, product_1_bookings: 2,
};

describe('Affinity page', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    mockOk('getAffinitySummary', summary);
    mockOk('getAffinityCustomers', { total: 0, customers: [] });
  });

  it('shows the table skeleton while customers load', () => {
    asMock('getAffinityCustomers').mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText('Loading customers')).toBeTruthy();
  });

  it('renders typical customers with formatted scores, dates and ranks', async () => {
    mockOk('getAffinityCustomers', { total: 1, customers: [customer] });
    renderPage();
    await screen.findByText('Ann');
    expect(screen.getByText('ann@x.com · +971')).toBeTruthy();
    expect(screen.getByText('12 Mar 2026')).toBeTruthy();
    expect(screen.getByText('0.46')).toBeTruthy();
    expect(screen.getByText('Bulk')).toBeTruthy();
    expect(screen.getByText('score 12.3 · 1 booking')).toBeTruthy();
    expect(bodyText()).toMatch(/1 customers · booked all time · page 1 of 1/);
    const visas = screen.getByText('No bookings').closest('button')!;
    expect(visas.disabled).toBe(true);
    expect(lastCall('getAffinityCustomers')).toMatchObject({ businessType: 'B2C', period: 'all', excludeBulk: 1, view: 'service', sort: 'score', limit: 25, page: 1 });
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the empty state when there are no customers', async () => {
    renderPage();
    await screen.findByText(/No customers booked all time with these filters/);
    expect((screen.getByText('Export CSV').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows "not built yet" and Build now calls rebuildAffinity', async () => {
    mockOk('getAffinitySummary', { status: 'idle' });
    renderPage();
    await screen.findByText(/haven.t been built yet/);
    fireEvent.click(screen.getByText('Build now'));
    await waitFor(() => expect(api.rebuildAffinity).toHaveBeenCalledTimes(1));
    await screen.findByText('Building… (a few minutes)');
  });

  it('shows summary, list and rebuild errors without crashing', async () => {
    asMock('getAffinityCustomers').mockRejectedValue(new Error('List boom'));
    renderPage();
    await screen.findByText('List boom');
    cleanup();
    asMock('getAffinitySummary').mockRejectedValue(new Error('Summary boom'));
    renderPage();
    await screen.findByText('Summary boom');
    cleanup();
    mockOk('getAffinitySummary', summary);
    asMock('rebuildAffinity').mockRejectedValue(new Error('Rebuild boom'));
    renderPage();
    const btn = await screen.findByText('Rebuild now');
    await waitFor(() => expect((btn.closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText('Rebuild boom');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('filters: period, bulk toggle, service card, sort, rows and search change the API params', async () => {
    renderPage();
    await screen.findByText(/No customers booked/);
    fireEvent.click(screen.getByText('Last week'));
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ period: 'week' }));
    expect(lastCall('getAffinitySummary')).toMatchObject({ period: 'week' });
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ excludeBulk: 0 }));
    fireEvent.click(screen.getByText('Tours').closest('button')!);
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ service: 'tours' }));
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'revenue' } });
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ sort: 'revenue' }));
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '50' } });
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ limit: 50 }));
    const input = screen.getByPlaceholderText(/Search name, email/);
    fireEvent.change(input, { target: { value: '  safari ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ search: 'safari' }));
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ search: '' }));
  });

  it('product tab loads top products and filters by product', async () => {
    mockOk('getAffinityTopProducts', { data: [{ product_key: 'p1', product_name: 'Desert Safari', customers: 30 }] });
    renderPage();
    await screen.findByText(/No customers booked/);
    fireEvent.click(screen.getByRole('tab', { name: 'Products' }));
    await waitFor(() => expect(api.getAffinityTopProducts).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 })));
    expect(localStorage.getItem('affinity-view')).toBe('product');
    fireEvent.click(await screen.findByText('Desert Safari'));
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ view: 'product', product: 'p1' }));
  });

  it('pagination moves pages and export passes the list params', async () => {
    mockOk('getAffinityCustomers', { total: 60, customers: [customer] });
    renderPage();
    await screen.findByText('1 / 3');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(lastCall('getAffinityCustomers')).toMatchObject({ page: 2 }));
    await screen.findByText('2 / 3');
    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() => expect(api.downloadAffinityCSV).toHaveBeenCalledWith(expect.objectContaining({ view: 'service', period: 'all' })));
  });

  it('row click opens the customer drawer with ranks; Escape closes it', async () => {
    mockOk('getAffinityCustomers', { total: 1, customers: [customer] });
    mockOk('getContactAffinity', {
      customer: { name: 'Ann Drawer', email: 'ann@x.com', contact_type: 'B2C', bookings_all: 9, revenue_all: 1234.6, affinity_score: 3, first_booking_date: '2024-01-02', last_booking_date: null, product_count: 5 },
      services: [{ service: 'tours', rank: 1, bookings: 3, cancelled: 1, revenue: 500, last_booking_date: '2026-01-01', affinity_score: 2 }],
      products: [{ product_key: 'p1', rank: 1, product_name: 'Desert Safari', services: ['tours'], bookings: 2, last_booking_date: '2026-01-01', affinity_score: 1.5 }],
    });
    renderPage();
    fireEvent.click(await screen.findByText('Ann'));
    await screen.findByText('Ann Drawer');
    expect(api.getContactAffinity).toHaveBeenCalledWith(5);
    expect(screen.getByText('AED 1,235')).toBeTruthy();
    expect(screen.getByText(/\+1 cancelled/)).toBeTruthy();
    expect(screen.getByText('Products (5, top 1 shown)')).toBeTruthy();
    expect(screen.getByText('Open contact profile').closest('a')!.getAttribute('href')).toBe('/contacts/5');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('drawer shows the load error', async () => {
    mockOk('getAffinityCustomers', { total: 1, customers: [customer] });
    asMock('getContactAffinity').mockRejectedValue(new Error('Drawer boom'));
    renderPage();
    fireEvent.click(await screen.findByText('Ann'));
    await screen.findByText('Drawer boom');
  });

  // BUG app/(dashboard)/affinity/page.tsx:324 + :511 - getAffinityCustomers' result is stored as-is
  // (`setList(d)`), then `list.customers.length` is read. A response without `customers` (e.g. `{}`
  // or `{ total: 0 }`) crashes the whole page with a TypeError instead of showing the empty state.
  it('survives a customers response with no customers array', async () => {
    mockOk('getAffinityCustomers', {});
    renderPage();
    await screen.findByText(/No customers booked/);
  });

  // BUG app/(dashboard)/affinity/page.tsx:72 - formatScore only guards null; a non-numeric score
  // (e.g. a string from the API) renders "NaN" in the Score column.
  it('never renders NaN for a non-numeric affinity score', async () => {
    mockOk('getAffinityCustomers', { total: 1, customers: [{ ...customer, affinity_score: 'n/a' }] });
    renderPage();
    await screen.findByText('Ann');
    expect(bodyText()).not.toContain('NaN');
  });
});
