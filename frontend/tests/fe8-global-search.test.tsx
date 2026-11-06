// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import {
  allContactsResult, contactResult, journeyResult, matchPages, segmentResult, templateResult,
} from '@/lib/globalSearch';
import type { SearchPage } from '@/types/globalSearch';

vi.mock('@/lib/api');
const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => '/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

const PAGES: SearchPage[] = [
  { href: '/dashboard', label: 'Home' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/journeys', label: 'Journeys' },
  { href: '/content', label: 'Templates' },
];

const m = vi.mocked(api);

function mockAll() {
  m.globalSearchJourneys.mockResolvedValue({ data: [{ journey_id: 12, name: 'Rocky payment recovery', status: 'active', segment_name: 'Payment failed' }], total: 1 });
  m.globalSearchTemplates.mockResolvedValue({ data: [{ id: 315, name: 'Rocky cruise mail', channel: 'email', status: 'draft', subject: 'Sail away' }], total: 1 });
  m.globalSearchSegments.mockResolvedValue({ data: [{ id: 95, name: 'Rocky testers', status: 'active', cached_count: 1234 }], total: 1 });
  m.globalSearchContacts.mockResolvedValue({
    data: [{ id: 1691142, name: 'Rocky IT', email: 'rocky@raynatours.com', mobile: '+91 7277011108', contact_type: 'B2C' }],
    total: 215,
  });
}

function mount(scope = 'All') {
  localStorage.setItem('business-type', scope);
  return render(<BusinessTypeProvider><GlobalSearch pages={PAGES} /></BusinessTypeProvider>);
}
const openDialog = () => fireEvent.click(screen.getByRole('button', { name: /Search contacts, journeys, templates and segments/ }));
const typeQuery = (text: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mockAll(); });
afterEach(() => { cleanup(); });

describe('global search helpers', () => {
  it('matchPages: every page with no query, label matches with one', () => {
    expect(matchPages(PAGES, '')).toHaveLength(4);
    expect(matchPages(PAGES, 'jour').map(r => r.href)).toEqual(['/journeys']);
    expect(matchPages(PAGES, 'zzz')).toEqual([]);
  });

  it('maps API rows to links on the real detail pages', () => {
    expect(journeyResult({ journey_id: 7, name: 'Welcome', status: 'paused', segment_name: 'New users' }))
      .toMatchObject({ href: '/journeys/7', title: 'Welcome', meta: '#7 · New users', tag: 'Paused' });
    expect(templateResult({ id: 3, name: null, channel: 'whatsapp', status: 'approved', subject: null }))
      .toMatchObject({ href: '/content/3', title: 'Template #3', meta: 'WhatsApp', tag: 'Approved' });
    expect(segmentResult({ id: 9, name: 'VIP', status: 'draft', cached_count: '1500' }))
      .toMatchObject({ href: '/segmentation/custom/9', meta: '1,500 contacts', tag: 'Draft' });
    expect(contactResult({ id: 4, name: '', email: 'a@b.com', mobile: '+971 50', contact_type: 'B2B' }))
      .toMatchObject({ href: '/contacts/4', title: 'a@b.com', meta: 'a@b.com · +971 50', tag: 'B2B' });
    expect(allContactsResult(' rocky ', 215)).toMatchObject({ href: '/contacts?q=rocky', title: 'See all 215 matching contacts' });
  });
});

describe('GlobalSearch — top bar search', () => {
  it('opens from the top bar and from ⌘K / Ctrl+K; Esc closes it', async () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    openDialog();
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no query it lists the menu pages; one letter never hits the server', async () => {
    mount();
    openDialog();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Go to')).toBeTruthy();
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    typeQuery('r');
    expect(await screen.findByText(/Type at least 2 characters/)).toBeTruthy();
    await new Promise(r => setTimeout(r, 400));
    expect(m.globalSearchContacts).not.toHaveBeenCalled();
    expect(m.globalSearchJourneys).not.toHaveBeenCalled();
  });

  it('searches journeys, templates, segments and contacts and shows each group', async () => {
    mount();
    openDialog();
    typeQuery('rocky');
    expect(await screen.findByText('Rocky payment recovery')).toBeTruthy();
    expect(screen.getByText('Rocky cruise mail')).toBeTruthy();
    expect(screen.getByText('Rocky testers')).toBeTruthy();
    expect(await screen.findByText('Rocky IT')).toBeTruthy();
    expect(screen.getByText('rocky@raynatours.com · +91 7277011108')).toBeTruthy();
    expect(screen.getByText('See all 215 matching contacts')).toBeTruthy();
    expect(screen.getByText('215 matches')).toBeTruthy();
    // One request per group, for this query only.
    expect(m.globalSearchJourneys).toHaveBeenCalledTimes(1);
    expect(m.globalSearchJourneys.mock.calls[0].slice(0, 2)).toEqual(['rocky', 'All']);
    expect(m.globalSearchTemplates.mock.calls[0][0]).toBe('rocky');
    expect(m.globalSearchSegments.mock.calls[0][0]).toBe('rocky');
    expect(m.globalSearchContacts.mock.calls[0].slice(0, 2)).toEqual(['rocky', 'All']);
  });

  it('arrow keys move the highlight and Enter opens the highlighted result', async () => {
    mount();
    openDialog();
    typeQuery('rocky');
    await screen.findByText('Rocky IT');
    const box = screen.getByRole('combobox');
    const first = screen.getAllByRole('option')[0];
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(first.textContent).toContain('Rocky payment recovery');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(nav.push).toHaveBeenCalledWith('/content/315');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking a contact opens its profile; "See all" opens the Contacts list with the query', async () => {
    mount();
    openDialog();
    typeQuery('rocky');
    fireEvent.click(await screen.findByText('Rocky IT'));
    expect(nav.push).toHaveBeenCalledWith('/contacts/1691142');

    openDialog();
    typeQuery('rocky');
    fireEvent.click(await screen.findByText('See all 215 matching contacts'));
    expect(nav.push).toHaveBeenLastCalledWith('/contacts?q=rocky');
  });

  it('follows the audience switch and offers to search all audiences', async () => {
    mount('B2B');
    openDialog();
    typeQuery('rocky');
    await screen.findByText('Rocky IT');
    expect(m.globalSearchContacts.mock.calls.at(-1)?.slice(0, 2)).toEqual(['rocky', 'B2B']);
    expect(m.globalSearchJourneys.mock.calls.at(-1)?.slice(0, 2)).toEqual(['rocky', 'B2B']);
    expect(screen.getByText(/Contacts and journeys are limited to/).textContent).toContain('B2B');

    fireEvent.click(screen.getByRole('button', { name: 'Search all audiences' }));
    await waitFor(() => expect(m.globalSearchContacts.mock.calls.at(-1)?.slice(0, 2)).toEqual(['rocky', 'All']));
    expect(screen.queryByText(/Contacts and journeys are limited to/)).toBeNull();
  });

  it('a failing list shows its own error while the others still show results', async () => {
    m.globalSearchSegments.mockRejectedValue(new Error('HTTP 500'));
    mount();
    openDialog();
    typeQuery('rocky');
    expect(await screen.findByText('Couldn’t search segments. Try again.')).toBeTruthy();
    expect(await screen.findByText('Rocky IT')).toBeTruthy();
    expect(screen.getByText('Rocky payment recovery')).toBeTruthy();
  });

  it('nothing found says so', async () => {
    m.globalSearchJourneys.mockResolvedValue({ data: [], total: 0 });
    m.globalSearchTemplates.mockResolvedValue({ data: [], total: 0 });
    m.globalSearchSegments.mockResolvedValue({ data: [], total: 0 });
    m.globalSearchContacts.mockResolvedValue({ data: [], total: 0 });
    mount();
    openDialog();
    typeQuery('qqqq');
    expect(await screen.findByText(/Nothing matches “qqqq”/)).toBeTruthy();
  });

  it('a slow answer for an older query never replaces the newer results', async () => {
    let releaseOld: (v: { data: { id: number; name: string }[]; total: number }) => void = () => {};
    m.globalSearchContacts.mockImplementation((q: string) => (q === 'ro'
      ? new Promise(res => { releaseOld = res; })
      : Promise.resolve({ data: [{ id: 2, name: 'Rocky IT' }], total: 1 })));
    mount();
    openDialog();
    typeQuery('ro');
    await waitFor(() => expect(m.globalSearchContacts).toHaveBeenCalledWith('ro', 'All', expect.anything()));
    typeQuery('rocky');
    expect(await screen.findByText('Rocky IT')).toBeTruthy();
    releaseOld({ data: [{ id: 1, name: 'Old Ronald' }], total: 1 });
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText('Old Ronald')).toBeNull();
    expect(screen.getByText('Rocky IT')).toBeTruthy();
  });
});
