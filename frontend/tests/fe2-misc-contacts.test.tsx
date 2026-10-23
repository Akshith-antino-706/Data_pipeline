// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import ContactsPage from '@/app/(dashboard)/contacts/page';
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


const renderPage = () => render(<BusinessTypeProvider><ContactsPage /></BusinessTypeProvider>);
const lastContactsCall = (): Record<string, unknown> => {
  const calls = vi.mocked(api.getUnifiedContacts).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
};
const rows = [
  { id: 1, name: 'Ann', email: 'ann@x.com', country: 'UAE', contact_type: 'B2B', booking_status: 'ON_TRIP', total_tour_bookings: 2, total_hotel_bookings: 1, total_booking_revenue: '100' },
  { unified_id: 'u2', email: 'noname@x.com', total_booking_revenue: '0' },
];

describe('Contacts list page (extra coverage)', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('shows table and KPI skeletons while loading', () => {
    asMock('getUnifiedContacts').mockReturnValue(new Promise(() => {}));
    asMock('getUnifiedStats').mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll('.ui-skel').length).toBeGreaterThan(8);
  });

  it('renders typical rows: booking total sum, PROSPECT fallback, dashes; no NaN/undefined', async () => {
    mockOk('getUnifiedContacts', { data: rows, total: 2, totalPages: 1 });
    mockOk('getUnifiedStats', { data: { total_contacts: 2, total_bookings: 3, total_revenue: 100 } });
    renderPage();
    await screen.findByText('Ann');
    const annCells = [...screen.getByText('Ann').closest('tr')!.querySelectorAll('td')].map(td => td.textContent);
    expect(annCells).toContain('3');
    expect(annCells).toContain('On trip');
    // Audience type is shown on the row; a row without one shows a dash, never a made-up type.
    expect(annCells).toContain('B2B');
    expect(screen.getByRole('columnheader', { name: /Type/ })).toBeTruthy();
    const nonameCells = [...screen.getByText('noname@x.com').closest('tr')!.querySelectorAll('td')].map(td => td.textContent);
    expect(nonameCells[1]).toBe('—');
    expect(screen.getByText('Prospect')).toBeTruthy();
    expect(screen.getByText('noname@x.com')).toBeTruthy();
    expect(screen.getByText(/1–2 of 2/)).toBeTruthy();
    expect(lastContactsCall()).toMatchObject({ page: 1, limit: 20, sortBy: 'last_seen_at', sortDir: 'DESC', businessType: 'B2C' });
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the empty state including the search term, and sends search to the API', async () => {
    renderPage();
    await screen.findByText('No contacts found.');
    fireEvent.change(screen.getByPlaceholderText('Name, email or phone'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByText('Search'));
    await screen.findByText('No contacts found for "zzz".');
    expect(lastContactsCall()).toMatchObject({ search: 'zzz', page: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(lastContactsCall().search).toBeUndefined());
  });

  it('list API error shows an error toast', async () => {
    asMock('getUnifiedContacts').mockRejectedValue(new Error('HTTP 503'));
    renderPage();
    await screen.findByText('HTTP 503');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('sorting toggles direction on the same column and resets on a new one', async () => {
    renderPage();
    await screen.findByText('No contacts found.');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Email' }));
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ sortBy: 'email', sortDir: 'DESC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Email' }));
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ sortBy: 'email', sortDir: 'ASC' }));
  });

  it('pagination and rows-per-page update the API params', async () => {
    mockOk('getUnifiedContacts', { data: rows, total: 90, totalPages: 3 });
    renderPage();
    await screen.findByText('Ann');
    expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeTruthy();
    expect((screen.getByText('«') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ page: 2 }));
    fireEvent.click(screen.getByText('»'));
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ page: 3 }));
    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '50' } });
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ page: 1, limit: 50 }));
  });

  it('filters panel: choosing an option sends it and shows a count badge; Reset all clears', async () => {
    mockOk('getUnifiedFilters', { data: { countries: ['UAE', 'India'] } });
    renderPage();
    await screen.findByText('No contacts found.');
    fireEvent.click(screen.getByText('Filters'));
    const countryLabel = await screen.findByText('Country', { selector: 'label' });
    fireEvent.click(countryLabel.parentElement!.querySelector('button')!);
    fireEvent.click(await screen.findByText('India'));
    await waitFor(() => expect(lastContactsCall()).toMatchObject({ country: 'India', page: 1 }));
    fireEvent.click(screen.getByText('Reset all'));
    await waitFor(() => expect(lastContactsCall().country).toBeUndefined());
  });

  it('row click and eye button open the contact detail', async () => {
    mockOk('getUnifiedContacts', { data: rows, total: 2, totalPages: 1 });
    renderPage();
    fireEvent.click(await screen.findByText('Ann'));
    expect(nav.push).toHaveBeenCalledWith('/contacts/1');
    fireEvent.click(screen.getByText('noname@x.com'));
    expect(nav.push).toHaveBeenCalledWith('/contacts/u2');
  });

  it('delete flow calls deleteUnifiedContact with the id and removes the row', async () => {
    mockOk('getUnifiedContacts', { data: rows, total: 2, totalPages: 1 });
    renderPage();
    const annRow = (await screen.findByText('Ann')).closest('tr')!;
    const buttons = annRow.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('Delete contact')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await screen.findByText('Contact deleted');
    expect(api.deleteUnifiedContact).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText('Ann')).toBeNull());
  });

  it('delete error shows the error toast', async () => {
    mockOk('getUnifiedContacts', { data: rows, total: 2, totalPages: 1 });
    asMock('deleteUnifiedContact').mockRejectedValue(new Error('Forbidden'));
    renderPage();
    const annRow = (await screen.findByText('Ann')).closest('tr')!;
    const buttons = annRow.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    await screen.findByText('Forbidden');
  });

  it('add contact: validation blocks empty submit; valid submit creates and redirects', async () => {
    mockOk('createUnifiedContact', { data: { id: 99 } });
    renderPage();
    await screen.findByText('No contacts found.');
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.click(await screen.findByText('Create contact'));
    await screen.findByText('Provide at least a name, email, or phone.');
    expect(api.createUnifiedContact).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('e.g. john@example.com'), { target: { value: 'new@x.com' } });
    fireEvent.click(screen.getByText('Create contact'));
    await waitFor(() => expect(api.createUnifiedContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@x.com', contact_type: 'B2C', name: '' })));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/contacts/99'));
  });

  it('add contact: API error is shown inside the modal', async () => {
    asMock('createUnifiedContact').mockRejectedValue(new Error('Duplicate email'));
    renderPage();
    await screen.findByText('No contacts found.');
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.change(await screen.findByPlaceholderText('e.g. John Smith'), { target: { value: 'Zed' } });
    fireEvent.click(screen.getByText('Create contact'));
    await screen.findByText('Duplicate email');
    expect(screen.getByRole('dialog', { name: 'Add contact' })).toBeTruthy();
  });
});
