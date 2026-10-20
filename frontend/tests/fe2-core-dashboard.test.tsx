// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import { AuthProvider } from '@/context/AuthContext';
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
// The Recharts charts are loaded through next/dynamic; replace them with a plain list of bar names.
// The Home 14-day chart (rows carry `email`) gets its own test id so `chart` stays the segment chart.
vi.mock('next/dynamic', () => ({
  default: () => function ChartStub({ data }: { data: { name: string; email?: number }[] }) {
    const id = data.length > 0 && 'email' in data[0] ? 'trend-chart' : 'chart';
    return <div data-testid={id}>{data.map(d => d.name + (d.email !== undefined ? `:${d.email}` : '')).join(',')}</div>;
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
    expect(screen.getByTestId('chart').textContent).toBe('On Trip,Custom X');
    expect(screen.getByText('9,999')).toBeTruthy();
    expect(screen.getByText('77')).toBeTruthy();
    expect(screen.getByText('Website')).toBeTruthy();
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
    await screen.findByText('Website');
    const [from] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.getContactSourcesBreakdown).toHaveBeenCalledWith('2026-10-01', undefined));
    await screen.findByText(/contacts added on\/after 2026-10-01/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(from.value).toBe('');
  });

  describe('Home sections (getOverviewHomeSection, one request per card)', () => {
    type Home = api.OverviewHome;
    const fullHome: Home = {
      sentToday: { available: true, email: 1200, whatsapp: 300, sms: 45, total: 1545 },
      delivery7d: { available: true, sent: 8000, delivered: 7800, deliveredPct: 97.5 },
      conversions30d: { available: true, count: 321 },
      runningJourneys: { available: true, journeys: [{ id: 42, name: 'Abandoned cart', status: 'active', joined: 880 }] },
      sendingToday: { available: true, total: 610, journeys: [{ id: 43, name: 'Pre-trip tips', due: 610 }] },
      series14d: { available: true, days: [{ date: '2026-10-18', email: 11, whatsapp: 2, sms: 1, total: 14 }] },
    };
    const off = { available: false, reason: 'unavailable' } as const;
    type SectionName = api.OverviewHomeSectionName;
    /** Serves each card from `home`, one call per section, like the real per-section endpoint. */
    const mockHome = (home: Home, override?: (section: SectionName) => Promise<Home[SectionName]> | undefined) => {
      vi.mocked(api.getOverviewHomeSection).mockImplementation(<K extends SectionName>(section: K): Promise<Home[K]> =>
        (override?.(section) as Promise<Home[K]> | undefined) ?? Promise.resolve(home[section]));
    };

    it('renders real values from the API', async () => {
      mockHome(fullHome);
      renderPage();
      await screen.findByText('1,545');
      expect(screen.getByText('97.5%')).toBeTruthy();
      expect(screen.getByText('7,800 of 8,000 sent')).toBeTruthy();
      expect(screen.getByText('321')).toBeTruthy();
      expect(screen.getByText('Abandoned cart').getAttribute('href')).toBe('/journeys?id=42');
      expect(screen.getByText('Pre-trip tips').getAttribute('href')).toBe('/journeys?id=43');
      expect(screen.getAllByText('610 due')).toHaveLength(2); // card total + the journey row
      expect(screen.getByTestId('trend-chart').textContent).toContain(':11');
      expect(screen.getByText('Create journey').closest('a')?.getAttribute('href')).toBe('/journeys/new');
      expect(screen.queryByText('Send a message')).toBeNull();
      expect(screen.queryByText(/Not available right now/)).toBeNull();
      expect(screen.getByText('Audience overview')).toBeTruthy();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    });

    it('shows the note for an unavailable section and no fake numbers', async () => {
      mockHome({ ...fullHome, sentToday: off, series14d: off });
      renderPage();
      await screen.findByText('97.5%');
      expect(screen.getAllByText(/Not available right now/)).toHaveLength(2);
      expect(screen.queryByText('1,545')).toBeNull();
      expect(screen.queryByTestId('trend-chart')).toBeNull();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    });

    it('requests every section separately, in parallel', async () => {
      mockHome(fullHome);
      renderPage();
      await screen.findByText('1,545');
      const asked = vi.mocked(api.getOverviewHomeSection).mock.calls.map(c => c[0]).sort();
      expect(asked).toEqual(['conversions30d', 'delivery7d', 'runningJourneys', 'sendingToday', 'sentToday', 'series14d']);
      expect(api.getOverviewHome).not.toHaveBeenCalled();
    });

    it('renders each card as soon as its own data arrives while a slow card keeps its skeleton', async () => {
      let releaseSeries: (v: Home['series14d']) => void = () => undefined;
      mockHome(fullHome, section => section === 'series14d'
        ? new Promise<Home['series14d']>(r => { releaseSeries = r; })
        : undefined);
      renderPage();
      await screen.findByText('1,545');
      expect(screen.getByText('97.5%')).toBeTruthy();
      expect(screen.getByText('Abandoned cart')).toBeTruthy();
      expect(screen.queryByTestId('trend-chart')).toBeNull();
      expect(screen.queryByText(/Not available right now/)).toBeNull();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
      releaseSeries(fullHome.series14d);
      expect((await screen.findByTestId('trend-chart')).textContent).toContain(':11');
    });

    it('a failing card shows the note while the others show data, and keeps the audience section', async () => {
      mockTypical();
      mockHome(fullHome, section => section === 'delivery7d' ? Promise.reject(new Error('HTTP 500')) : undefined);
      renderPage();
      await screen.findByText('1,545');
      await screen.findByText(/Not available right now/);
      expect(screen.queryByText('97.5%')).toBeNull();
      expect(screen.getByText('321')).toBeTruthy();
      await screen.findByText('1,234');
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    });

    it('a timed-out card keeps loading and fills in automatically (server finishes in background)', async () => {
      let calls = 0;
      mockHome(fullHome, section => {
        if (section !== 'conversions30d') return undefined;
        calls += 1;
        return Promise.resolve(calls === 1 ? { available: false, reason: 'timeout' } as const : fullHome.conversions30d);
      });
      renderPage();
      await screen.findByText('1,545');
      expect(screen.queryByText(/Not available right now/)).toBeNull(); // still loading, not an error
      await screen.findByText('321', undefined, { timeout: 7000 });
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    }, 10000);

    it('an unavailable card retries only that section with "Try again"', async () => {
      let conversionCalls = 0;
      mockHome(fullHome, section => {
        if (section !== 'conversions30d') return undefined;
        conversionCalls += 1;
        return Promise.resolve(conversionCalls === 1 ? { available: false, reason: 'unavailable' } as const : fullHome.conversions30d);
      });
      renderPage();
      await screen.findByText('1,545');
      const retry = await screen.findByRole('button', { name: 'Try again' });
      expect(screen.getAllByText(/Not available right now/)).toHaveLength(1);
      const before = vi.mocked(api.getOverviewHomeSection).mock.calls.length;
      fireEvent.click(retry);
      await screen.findByText('321');
      const after = vi.mocked(api.getOverviewHomeSection).mock.calls.slice(before).map(c => c[0]);
      expect(after).toEqual(['conversions30d']);
      expect(screen.queryByText(/Not available right now/)).toBeNull();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    });

    it('running journeys shows the top 5 and "View all N"', async () => {
      const journeys = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `J${i + 1}`, status: 'active', joined: i }));
      mockHome({ ...fullHome, runningJourneys: { available: true, total: 12, journeys } });
      renderPage();
      await screen.findByText('J5');
      expect(screen.getByText('View all 12')).toBeTruthy();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
    });

    it('shows failed sends in the last 24h from the status API', async () => {
      mockHome(fullHome);
      const recent = new Date(Date.now() - 3600 * 1000).toISOString();
      const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      vi.mocked(api.getOverviewStatus).mockResolvedValue({
        dataSources: off, queues: off,
        failedSends: { available: true, rows: [
          { channel: 'email', id: 1, recipient: null, reason: 'bounce', time: recent, journeyId: null },
          { channel: 'sms', id: 2, recipient: null, reason: null, time: old, journeyId: null },
        ] },
      });
      renderPage();
      await screen.findByText(/failed send in the last 24 hours/);
      expect(screen.getByText('View failed').closest('a')?.getAttribute('href')).toBe('/log?channel=all&status=failed');
    });

    it('greets the signed-in user by first name', async () => {
      localStorage.setItem('rayna-auth', JSON.stringify({ token: 't', user: { id: 1, email: 'a@b.c', name: 'Avinash Kumar', role: 'admin' } }));
      mockHome(fullHome);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><AuthProvider><BusinessTypeProvider><Dashboard /></BusinessTypeProvider></AuthProvider></QueryClientProvider>);
      expect(await screen.findByText(/^Good (morning|afternoon|evening), Avinash$/)).toBeTruthy();
    });
  });
});
