// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import Journeys from '@/app/(dashboard)/journeys/page';

vi.mock('@/lib/api');
const nav = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.replace, replace: nav.replace, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/journeys',
  useSearchParams: () => nav.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn<(m: string) => void>(), error: vi.fn<(m: string) => void>() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

class RO { observe(): void {} unobserve(): void {} disconnect(): void {} }
const fetchStub = vi.fn<() => Promise<Response>>(() => Promise.reject(new Error('network disabled')));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.replace.mockReset();
  nav.search = new URLSearchParams();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  localStorage.setItem('business-type', 'All');
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><Journeys /></BusinessTypeProvider>);

const J = (id: number, name: string, status: string, extra: Record<string, unknown> = {}) => ({
  journey_id: id, name, status, segment_name: `Seg ${id}`, total_entries: 100 * id, node_count: 3, conversion_rate: '12.5', created_at: '2026-10-01T00:00:00Z', ...extra,
});
const LIST = [
  J(1, 'Welcome Series', 'active'),
  J(2, 'B2B Onboarding', 'active', { segment_name: 'All B2B users' }),
  J(3, 'Old Draft', 'draft', { conversion_rate: 'abc', total_entries: null }),
  J(4, 'Paused One', 'paused'),
];
const mockList = (data: unknown[]) => vi.mocked(api.getJourneys).mockResolvedValue({ data });

describe('Journeys list page', () => {
  it('renders KPIs and active journeys by default', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    expect(api.getJourneys).toHaveBeenCalledWith({ limit: 1000 });
    expect(screen.getByText('B2B Onboarding')).toBeTruthy();
    expect(screen.queryByText('Old Draft')).toBeNull(); // default filter = active
    expect(screen.getByText('700')).toBeTruthy(); // total entries 100+200+0(null)+400
    expect(screen.getByText('9.4%')).toBeTruthy(); // avg conversion (12.5*3 + 0)/4
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the "No Journeys Yet" empty state', async () => {
    mockList([]);
    renderPage();
    await screen.findByText('No Journeys Yet');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('falls back to an empty list when the API errors', async () => {
    vi.mocked(api.getJourneys).mockRejectedValue(new Error('HTTP 500'));
    renderPage();
    await screen.findByText('No Journeys Yet');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows skeleton KPIs while loading', () => {
    vi.mocked(api.getJourneys).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(screen.getByText('Journey Builder')).toBeTruthy();
    expect(screen.getByText('Total Journeys')).toBeTruthy();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(4);
  });

  it('status filter, search and clear filters', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(screen.getByText('Old Draft')).toBeTruthy();
    expect(screen.queryByText('Welcome Series')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Paused One')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search journeys...'), { target: { value: 'b2b users' } });
    expect(screen.getByText('B2B Onboarding')).toBeTruthy();
    expect(screen.queryByText('Welcome Series')).toBeNull();
    expect(screen.getByText('1 result')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search journeys...'), { target: { value: 'zzz' } });
    expect(screen.getByText('No journeys match your filters')).toBeTruthy();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(screen.getByText('Old Draft')).toBeTruthy();
  });

  it('business type B2B only shows B2B journeys', async () => {
    localStorage.setItem('business-type', 'B2B');
    mockList(LIST);
    renderPage();
    await screen.findByText('B2B Onboarding');
    expect(screen.queryByText('Welcome Series')).toBeNull();
  });

  it('list view renders a table with segment and conversion', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const toggles = document.querySelectorAll('button.flex.items-center');
    fireEvent.click(toggles[toggles.length - 1]);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Seg 1')).toBeTruthy();
    expect(within(table).getAllByText('12.5%').length).toBe(3);
  });

  // BUG: app/(dashboard)/journeys/page.tsx:4816 — the list view renders {pct(j.conversion_rate)}
  // directly; pct() (line 578) does Number(n || 0).toFixed(1), so a non-numeric conversion_rate
  // string renders "NaN%". The card view guards with parseFloat(...) || 0, the list view does not.
  it('list view never renders NaN% for a non-numeric conversion_rate', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const toggles = document.querySelectorAll('button.flex.items-center');
    fireEvent.click(toggles[toggles.length - 1]);
    await screen.findByRole('table');
    expect(bodyText()).not.toContain('NaN');
  });

  it('paginates 24 per page', async () => {
    mockList(Array.from({ length: 30 }, (_, i) => J(i + 1, `Journey ${i + 1}`, 'active')));
    renderPage();
    await screen.findByText('Journey 1');
    expect(bodyText()).toContain('Showing 1–24 of 30 journeys');
    expect(screen.queryByText('Journey 25')).toBeNull();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Journey 25')).toBeTruthy();
    expect(bodyText()).toContain('Page 2 of 2');
    expect((screen.getByText('Next').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Prev'));
    expect(screen.getByText('Journey 1')).toBeTruthy();
  });

  it('delete confirmation calls deleteJourney with the id and reloads', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getAllByTitle('Delete journey')[0]);
    expect(screen.getByText('This action cannot be undone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteJourney).toHaveBeenCalledWith(1));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Journey deleted successfully'));
    expect(api.getJourneys).toHaveBeenCalledTimes(2);
  });

  it('delete failure shows an error toast and keeps the modal', async () => {
    mockList(LIST);
    vi.mocked(api.deleteJourney).mockRejectedValue(new Error('cannot delete'));
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getAllByTitle('Delete journey')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('cannot delete'));
    expect(screen.getByText('This action cannot be undone')).toBeTruthy();
  });

  it('cancel in delete modal does not call the API', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getAllByTitle('Delete journey')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteJourney).not.toHaveBeenCalled();
  });

  it('New Journey opens the create page with Create disabled until valid', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('New Journey'));
    await screen.findByText('Create New Journey');
    const createBtn = screen.getAllByRole('button', { name: /Create Journey/ })[0] as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('e.g., Welcome Series — New Customers'), { target: { value: 'My new journey' } });
    expect(createBtn.disabled).toBe(true); // still no segment / nodes
    expect(api.createJourney).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Back'));
    await screen.findByText('Welcome Series');
  });

  it('clicking a journey card opens its detail and updates the URL', async () => {
    mockList(LIST);
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await waitFor(() => expect(api.getJourney).toHaveBeenCalledWith(1));
    expect(api.getJourneyTimeline).toHaveBeenCalledWith(1);
    expect(nav.replace).toHaveBeenCalledWith('/journeys?id=1', { scroll: false });
    expect(screen.queryByText('Welcome Series')).toBeNull(); // detail skeleton
  });

  it('restores the selected journey from ?id= on load', async () => {
    nav.search = new URLSearchParams('id=7');
    mockList(LIST);
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(api.getJourney).toHaveBeenCalledWith(7));
  });

  // BUG: app/(dashboard)/journeys/page.tsx:941-980 + 1515-1567 — when getJourney rejects,
  // openJourney sets showToast('Failed to load journey') but leaves selected set and detail null,
  // so the page stays on the detail skeleton (which renders no toast) forever: the user never
  // sees the error and has no way back except the browser.
  it('a failing journey detail load surfaces the error to the user', async () => {
    mockList(LIST);
    vi.mocked(api.getJourney).mockRejectedValue(new Error('detail failed'));
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await waitFor(() => expect(api.getJourney).toHaveBeenCalledWith(1));
    await waitFor(() => expect(bodyText()).toContain('Failed to load journey'));
  });
});
