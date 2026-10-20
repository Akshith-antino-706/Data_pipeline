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
  pathname: '/journeys',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.replace, replace: nav.replace, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => nav.pathname,
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
  nav.pathname = '/journeys';
  window.history.replaceState(null, '', '/journeys');
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

  it('shows the "Create your first journey" empty state', async () => {
    mockList([]);
    renderPage();
    await screen.findByText('Create your first journey');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows an error state with retry when the API errors', async () => {
    vi.mocked(api.getJourneys).mockRejectedValueOnce(new Error('HTTP 500'));
    renderPage();
    await screen.findByText("Couldn't load journeys");
    expect(bodyText()).toContain('HTTP 500');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    mockList(LIST);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Welcome Series');
    expect(api.getJourneys).toHaveBeenCalledTimes(2);
  });

  it('status tabs show counts that follow the filters', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    expect(screen.getByRole('tab', { name: 'All 4' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Running 2' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Drafts 1' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search by name or segment'), { target: { value: 'b2b' } });
    expect(screen.getByRole('tab', { name: 'All 1' })).toBeTruthy();
  });

  it('a draft with a future start shows under Scheduled, not Drafts', async () => {
    mockList([...LIST, J(5, 'Future Launch', 'draft', { scheduled_start_at: '2999-01-01T00:00:00Z' })]);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('tab', { name: /^Scheduled/ }));
    expect(screen.getByText('Future Launch')).toBeTruthy();
    expect(screen.queryByText('Old Draft')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(screen.queryByText('Future Launch')).toBeNull();
  });

  it('sorts by name and by most joined', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }));
    const want = ['Welcome Series', 'B2B Onboarding', 'Old Draft', 'Paused One'];
    const names = () => Array.from(document.querySelectorAll('button')).map(b => b.textContent ?? '').filter(t => want.includes(t));
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    expect(names()).toEqual(['B2B Onboarding', 'Old Draft', 'Paused One', 'Welcome Series']);
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'joined' } });
    expect(names()).toEqual(['Paused One', 'B2B Onboarding', 'Welcome Series', 'Old Draft']);
  });

  it('type filter uses journey_type', async () => {
    mockList([J(1, 'Fixed One', 'active'), J(2, 'Live One', 'active', { journey_type: 'gtm' })]);
    renderPage();
    await screen.findByText('Fixed One');
    fireEvent.change(screen.getByLabelText('Journey type'), { target: { value: 'always' } });
    expect(screen.getByText('Live One')).toBeTruthy();
    expect(screen.queryByText('Fixed One')).toBeNull();
  });

  it('shows skeleton KPIs while loading', () => {
    vi.mocked(api.getJourneys).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(screen.getByRole('heading', { name: 'Journeys' })).toBeTruthy();
    expect(screen.getByText('Total journeys')).toBeTruthy();
    expect(container.querySelectorAll('.ui-skel').length).toBeGreaterThanOrEqual(4);
  });

  it('status filter, search and clear filters', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(screen.getByText('Old Draft')).toBeTruthy();
    expect(screen.queryByText('Welcome Series')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }));
    expect(screen.getByText('Paused One')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search by name or segment'), { target: { value: 'b2b users' } });
    expect(screen.getByText('B2B Onboarding')).toBeTruthy();
    expect(screen.queryByText('Welcome Series')).toBeNull();
    expect(screen.getByText('1 result')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search by name or segment'), { target: { value: 'zzz' } });
    expect(screen.getByText('No journeys match your filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
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
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
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
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    await screen.findByRole('table');
    expect(bodyText()).not.toContain('NaN');
  });

  it('paginates 24 per page', async () => {
    mockList(Array.from({ length: 30 }, (_, i) => J(i + 1, `Journey ${i + 1}`, 'active')));
    renderPage();
    await screen.findByText('Journey 1');
    expect(bodyText()).toContain('Showing 1–24 of 30 journeys');
    expect(screen.queryByText('Journey 25')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Journey 25')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
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

  it('Create journey links to the /journeys/new route (header and empty state)', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    expect(screen.getByRole('link', { name: 'Create journey' }).getAttribute('href')).toBe('/journeys/new');
    cleanup();
    mockList([]);
    renderPage();
    await screen.findByText('Create your first journey');
    for (const a of screen.getAllByRole('link', { name: 'Create journey' })) expect(a.getAttribute('href')).toBe('/journeys/new');
  });

  it('/journeys/new opens the create wizard; Next is blocked until the step is valid; Cancel goes to /journeys', async () => {
    nav.pathname = '/journeys/new';
    mockList(LIST);
    renderPage();
    await screen.findByRole('heading', { name: 'Create journey' });
    expect(screen.getByRole('button', { name: /Basics/ }).getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Give the journey a name.')).toBeTruthy();
    expect(api.createJourney).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('e.g., Welcome Series — New Customers'), { target: { value: 'My new journey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'How do people join?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(nav.replace).toHaveBeenCalledWith('/journeys');
  });

  it('/journeys still shows the list, not the wizard', async () => {
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    expect(screen.queryByRole('heading', { name: 'What is this journey for?' })).toBeNull();
  });

  it('clicking a journey card opens its detail and updates the URL', async () => {
    mockList(LIST);
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText('Welcome Series');
    fireEvent.click(screen.getByText('Welcome Series'));
    await waitFor(() => expect(api.getJourney).toHaveBeenCalledWith(1));
    expect(api.getJourneyTimeline).toHaveBeenCalledWith(1);
    expect(window.location.pathname).toBe('/journeys/1');
    expect(window.location.search).toBe('');
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Welcome Series')).toBeNull(); // detail skeleton
  });

  it('/journeys/7 opens that journey\'s detail on load', async () => {
    nav.pathname = '/journeys/7';
    window.history.replaceState(null, '', '/journeys/7');
    mockList(LIST);
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(api.getJourney).toHaveBeenCalledWith(7));
    expect(window.location.pathname).toBe('/journeys/7');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('an old /journeys?id=7 link redirects to /journeys/7', async () => {
    nav.search = new URLSearchParams('id=7');
    mockList(LIST);
    renderPage();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/journeys/7'));
    expect(api.getJourney).not.toHaveBeenCalled();
  });

  it('/journeys/new shows the wizard and never treats "new" as a journey id', async () => {
    nav.pathname = '/journeys/new';
    mockList(LIST);
    renderPage();
    await screen.findByRole('heading', { name: 'Create journey' });
    expect(api.getJourney).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain('Journey not found');
  });

  it('a non-numeric /journeys/abc shows the list with "Journey not found" instead of crashing', async () => {
    nav.pathname = '/journeys/abc';
    window.history.replaceState(null, '', '/journeys/abc');
    mockList(LIST);
    renderPage();
    await screen.findByText('Welcome Series');
    expect(bodyText()).toContain('Journey not found');
    expect(api.getJourney).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/journeys');
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
    expect(window.location.pathname).toBe('/journeys');
  });
});
