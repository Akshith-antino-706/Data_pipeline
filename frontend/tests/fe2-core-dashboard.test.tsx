// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import Dashboard from '@/app/(dashboard)/dashboard/page';

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
// The Recharts chart is loaded through next/dynamic; replace it with a plain list of bar names.
vi.mock('next/dynamic', () => ({
  default: () => function ChartStub({ data }: { data: { name: string }[] }) {
    return <div data-testid="chart">{data.map(d => d.name).join(',')}</div>;
  },
}));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BusinessTypeProvider><Dashboard /></BusinessTypeProvider></QueryClientProvider>);
};
type Tree = Awaited<ReturnType<typeof api.getSegmentationTree>>;

function mockTypical() {
  vi.mocked(api.getSegmentationTree).mockResolvedValue({
    totals: { total: 1234, segment_count: 6 },
    statusCounts: [
      { booking_status: 'ON_TRIP', count: 10, revenue: 5000 },
      { booking_status: 'CUSTOM_X', count: 2 },
    ],
    revenueByType: { total: 2500000 },
  } as unknown as Tree);
  vi.mocked(api.getSegmentActivity).mockResolvedValue({ logs: [{ entered: 3, converted: 1, total_reached: 40 }, { entered: 2 }] } as unknown as Awaited<ReturnType<typeof api.getSegmentActivity>>);
  vi.mocked(api.getUnifiedStats).mockResolvedValue({ data: { total_contacts: 9999, conversations_7d: 77 } } as unknown as Awaited<ReturnType<typeof api.getUnifiedStats>>);
  vi.mocked(api.getCampaigns).mockResolvedValue({ total: 3 } as unknown as Awaited<ReturnType<typeof api.getCampaigns>>);
  vi.mocked(api.getJourneys).mockResolvedValue({ total: 4 } as unknown as Awaited<ReturnType<typeof api.getJourneys>>);
  vi.mocked(api.getContactSourcesBreakdown).mockResolvedValue({ data: { total: 50, sources: [{ source: 'website', count: 30 }, { source: 'whatsapp', count: 20 }] } } as unknown as Awaited<ReturnType<typeof api.getContactSourcesBreakdown>>);
}

describe('Dashboard page', () => {
  it('renders KPIs, chart, activity, sources and revenue table with typical data', async () => {
    mockTypical();
    renderPage();
    await screen.findByText('1,234');
    expect(screen.getByText('AED 2.50M')).toBeTruthy();
    expect(screen.getByText('AED 5,000')).toBeTruthy();
    expect(screen.getByText('AED 0')).toBeTruthy(); // missing revenue -> 0
    expect(screen.getByTestId('chart').textContent).toBe('On Trip,CUSTOM_X');
    expect(screen.getByText('9,999')).toBeTruthy();
    expect(screen.getByText('77')).toBeTruthy();
    expect(screen.getByText('website')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy(); // entered 3 + 2
    expect(screen.getByText('B2C Overview', { exact: false })).toBeTruthy();
    expect(api.getUnifiedStats).toHaveBeenCalledWith({ businessType: 'B2C', cached: 1 });
    expect(api.getSegmentationTree).toHaveBeenCalledWith({ businessType: 'B2C' });
    expect(api.getSegmentActivity).toHaveBeenCalledWith({ days: 7 });
    expect(api.getContactSourcesBreakdown).toHaveBeenCalledWith(undefined, undefined);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows empty states when every API returns an empty object', async () => {
    renderPage();
    await screen.findByText('No segment data available');
    expect(screen.getByText('No Data Available')).toBeTruthy();
    expect(screen.getByText('No activity in the last 7 days')).toBeTruthy();
    expect(screen.getByText('No segment revenue data available')).toBeTruthy();
    await screen.findByText('Failed to load sources.');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows "no contacts added" when the sources list is empty', async () => {
    vi.mocked(api.getContactSourcesBreakdown).mockResolvedValue({ data: { total: 0, sources: [] } } as unknown as Awaited<ReturnType<typeof api.getContactSourcesBreakdown>>);
    renderPage();
    await screen.findByText('No contacts were added in the selected range.');
    expect(bodyText()).toContain('0 sources');
  });

  it('survives every API rejecting', async () => {
    for (const fn of [api.getSegmentationTree, api.getSegmentActivity, api.getUnifiedStats, api.getCampaigns, api.getJourneys, api.getContactSourcesBreakdown]) {
      vi.mocked(fn).mockRejectedValue(new Error('HTTP 500'));
    }
    renderPage();
    await screen.findByText('Failed to load sources.');
    await screen.findByText('No Data Available');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows skeletons and disables refresh while loading', () => {
    const never = new Promise<never>(() => {});
    vi.mocked(api.getSegmentationTree).mockReturnValue(never);
    vi.mocked(api.getSegmentActivity).mockReturnValue(never);
    vi.mocked(api.getContactSourcesBreakdown).mockReturnValue(never);
    const { container } = renderPage();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(5);
    const refresh = container.querySelector('.page-actions button');
    expect(refresh?.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('No Data Available')).toBeNull();
  });

  it('refresh button refetches the dashboard queries', async () => {
    mockTypical();
    const { container } = renderPage();
    await screen.findByText('1,234');
    const before = vi.mocked(api.getSegmentationTree).mock.calls.length;
    const refresh = container.querySelector('.page-actions button');
    if (!refresh) throw new Error('refresh button missing');
    fireEvent.click(refresh);
    await waitFor(() => expect(vi.mocked(api.getSegmentationTree).mock.calls.length).toBeGreaterThan(before));
  });

  it('revenue filter: product select fetches filtered tree and Clear all resets', async () => {
    mockTypical();
    renderPage();
    await screen.findByText('1,234');
    fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
    const productSelect = screen.getByDisplayValue('All Products');
    fireEvent.change(productSelect, { target: { value: 'tours' } });
    await waitFor(() => expect(api.getSegmentationTree).toHaveBeenCalledWith({ businessType: 'B2C', product: 'tours' }));
    expect(screen.getByRole('button', { name: /Filter \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getByRole('button', { name: /^Filter$/ })).toBeTruthy();
  });

  it('revenue filter: This Year preset sends travel dates', async () => {
    mockTypical();
    renderPage();
    await screen.findByText('1,234');
    fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
    fireEvent.click(screen.getByText('This Year'));
    const y = new Date().getFullYear();
    await waitFor(() => expect(api.getSegmentationTree).toHaveBeenCalledWith({ businessType: 'B2C', travelFrom: `${y}-01-01`, travelTo: `${y}-12-31` }));
    expect(bodyText()).toContain(`Travel ${y}-01-01 → ${y}-12-31`);
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByText('This Year')).toBeNull();
  });

  it('sources date filter passes from/to and Clear resets them', async () => {
    mockTypical();
    const { container } = renderPage();
    await screen.findByText('website');
    const [from] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.getContactSourcesBreakdown).toHaveBeenCalledWith('2026-10-01', undefined));
    await screen.findByText(/contacts added on\/after 2026-10-01/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(from.value).toBe('');
  });
});
