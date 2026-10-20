// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import Content from '@/app/(dashboard)/content/page';
import NewTemplatePage from '@/app/(dashboard)/content/new/page';
import EditTemplatePage from '@/app/(dashboard)/content/[id]/page';
import {
  cleanExcerpt, placeholderLabel, readablePlaceholders, readableTitle, relativeTime, splitPlaceholders,
} from '@/app/(dashboard)/content/templateText';

vi.mock('@/lib/api');

const h = vi.hoisted(() => ({
  toastError: vi.fn<(m: string) => void>(),
  toastSuccess: vi.fn<(m: string) => void>(),
  pathname: '/content',
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
// Sub-panels have their own data flows; stub them so this file tests the template page itself.
vi.mock('@/app/(dashboard)/content/WhatsAppTestSend', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/CreateWhatsAppTemplate', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/SmsTestSend', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/RcsTestSend', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type Ret<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
const as = <F extends (...args: never[]) => unknown>(_fn: F, v: unknown): Ret<F> => v as unknown as Ret<F>;
const jsonResponse = (body: unknown): Response => ({ ok: true, json: () => Promise.resolve(body) } as unknown as Response);

const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const ROCKY = 'rocky.86agency@gmail.com';
const T1 = { id: 1, name: 'Day 1 Welcome', channel: 'email', status: 'approved', subject: 'Welcome!', body: '<p>Hello {{first_name}}</p>' };
const T2 = { id: 20, name: 'WA Promo', channel: 'whatsapp', status: 'draft', body_plain: 'Promo text', cta_text: 'Book now', segment_label: 'VIP' };

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.pathname = '/content';
  window.history.replaceState(null, '', '/content');
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const noBadText = () => { expect(bodyText()).not.toContain('NaN'); expect(bodyText()).not.toContain('undefined'); };
const where = () => `${window.location.pathname}${window.location.search}`;

function mockTemplates(data: unknown[] = [T1, T2], total = 45) {
  vi.mocked(api.getTemplates).mockResolvedValue(as(api.getTemplates, { data, total }));
}
// Library returns `all`; the approval queue (status=pending_approval) returns `pending`.
function mockLists(all: unknown[], pending: unknown[]) {
  vi.mocked(api.getTemplates).mockImplementation(params => Promise.resolve(as(api.getTemplates,
    params?.status === 'pending_approval' ? { data: pending, total: pending.length } : { data: all, total: all.length })));
}
const card = (name: string) => screen.getByRole('article', { name });
const openMenu = (name: string) => fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
const menuItem = (name: string | RegExp) => within(screen.getByRole('menu')).getByRole('menuitem', { name });
const sectionTab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Templates sections' })).getByRole('tab', { name });

describe('Templates text helpers', () => {
  it('cleanExcerpt drops <head>/<style>/<script>, CSS, Liquid and developer notes, and decodes entities', () => {
    const html = `<html><head><title>X</title><style>html,body{margin:0 auto !important;padding:0}</style></head>
      <body><script>var a = 1;</script><!-- hidden -->{% if user %}<p>Hi&nbsp;{{first_name}} &amp; friends</p>{% endif %}
      <p>Helpers : eq, gt, formatDate</p><p>Book your desert safari today.</p></body></html>`;
    const out = cleanExcerpt(html);
    expect(out).toBe('Hi {{first_name}} & friends Book your desert safari today.');
    // A body_plain that kept the CSS text (tags were stripped but <style> contents weren't)
    expect(cleanExcerpt('html,body{margin:0 auto !important;padding:0} .btn{color:red} Welcome aboard! Helpers : eq, gt, formatDate')).toBe('Welcome aboard!');
    // Nothing but code → nothing
    expect(cleanExcerpt('<style>.a{color:red}</style><div style="x"></div>')).toBe('');
    expect(cleanExcerpt('function x() { return 1; }')).toBe('');
    expect(cleanExcerpt(null)).toBe('');
    expect(cleanExcerpt(`<p>${'word '.repeat(100)}</p>`).length).toBeLessThanOrEqual(220);
  });

  it('converts placeholders to readable tags without changing the source', () => {
    expect(placeholderLabel('coupon.code')).toBe('[coupon code]');
    expect(placeholderLabel('cardOffer.title')).toBe('[card offer title]');
    expect(placeholderLabel(' commission.ratePercent ')).toBe('[commission rate %]');
    expect(placeholderLabel('USER_FIRST_NAME')).toBe('[user first name]');
    expect(placeholderLabel('name | default: "friend"')).toBe('[name]');
    expect(splitPlaceholders('Use {{coupon.code}} now')).toEqual([
      { kind: 'text', text: 'Use ' }, { kind: 'tag', text: '[coupon code]' }, { kind: 'text', text: ' now' },
    ]);
    expect(readablePlaceholders('Earn {{ commission.ratePercent }} on {{cardOffer.title}}')).toBe('Earn [commission rate %] on [card offer title]');
  });

  it('makes snake_case names readable and keeps normal names', () => {
    expect(readableTitle('affiliate_01_joined')).toBe('Affiliate 01 joined');
    expect(readableTitle('welcome-series-day-2')).toBe('Welcome series day 2');
    expect(readableTitle('Day 1 Welcome')).toBe('Day 1 Welcome');
    expect(readableTitle('')).toBe('Untitled template');
  });

  it('writes human relative dates', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(relativeTime('2026-10-17T12:00:00Z', now)).toBe('3 days ago');
    expect(relativeTime('2026-10-19T11:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-10-20T11:00:00Z', now)).toBe('1 hour ago');
    expect(relativeTime('2026-10-20T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('not a date', now)).toBe('');
    expect(relativeTime(undefined, now)).toBe('');
    expect(relativeTime('2026-01-02T12:00:00Z', now)).toMatch(/2026/);
  });
});

describe('Templates page — library', () => {
  it('renders the header, chips, tabs and template cards from typical data', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(api.getTemplates).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /New template/ })).toBeTruthy();
    expect(bodyText()).toContain('45 templates');
    expect(sectionTab(/Library/).getAttribute('aria-selected')).toBe('true');
    // Tab order: Library · Testing · Waiting for approval (Library is the default)
    expect(within(screen.getByRole('tablist', { name: 'Templates sections' })).getAllByRole('tab').map(t => t.textContent))
      .toEqual(['Library', 'Testing', 'Waiting for approval']);
    expect(screen.getByText('WA Promo')).toBeTruthy();
    expect(bodyText()).toContain('Showing 1–2 of 45');
    expect(within(card('Day 1 Welcome')).getByTitle('Welcome!').textContent).toBe('Welcome!');
    expect(within(card('Day 1 Welcome')).getByText('Subject')).toBeTruthy();
    expect(card('Day 1 Welcome').textContent).toContain('Hello [first name]');
    expect(screen.getByText('Promo text')).toBeTruthy();
    expect(screen.getByText('Button: Book now')).toBeTruthy();
    expect(within(card('Day 1 Welcome')).getByText('Approved')).toBeTruthy();
    expect(within(card('WA Promo')).getByText('Draft')).toBeTruthy();
    expect(bodyText()).toMatch(/Page\s*1\s*of\s*3/);
    // The active channel chip carries the real total
    const all = within(screen.getByRole('group', { name: 'Channel' })).getByRole('button', { name: /^All/ });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(all.textContent).toBe('All45');
    noBadText();
  });

  it('cards show readable titles, placeholder tags, a clean excerpt and "Updated … ago"', async () => {
    const updated = new Date(Date.now() - 3 * 86400000).toISOString();
    mockTemplates([{
      id: 50, name: 'affiliate_01_joined', channel: 'email', status: 'pending_approval', updated_at: updated,
      subject: 'Your code {{coupon.code}} for {{cardOffer.title}}',
      body: '<html><head><style>html,body{margin:0 auto !important;padding:0}</style></head><body><p>Earn {{ commission.ratePercent }} today</p><p>Helpers : eq, gt, formatDate</p></body></html>',
    }], 1);
    render(<Content />);
    const c = await screen.findByRole('article', { name: 'Affiliate 01 joined' });
    expect(within(c).getByRole('heading', { level: 3, name: 'Affiliate 01 joined' })).toBeTruthy();
    expect(within(c).getByText('affiliate_01_joined')).toBeTruthy();
    const subject = within(c).getByTitle('Your code [coupon code] for [card offer title]');
    expect(within(subject).getByText('[coupon code]').className).toMatch(/phTag/);
    expect(within(subject).getByText('[card offer title]')).toBeTruthy();
    expect(within(c).getByText('[commission rate %]')).toBeTruthy();
    expect(c.textContent).not.toContain('{{');
    expect(c.textContent).not.toContain('margin:0');
    expect(c.textContent).not.toContain('Helpers');
    expect(within(c).getByText('Waiting for approval')).toBeTruthy();
    expect(c.textContent).not.toContain('pending_approval');
    const upd = within(c).getByText('Updated 3 days ago');
    expect(upd.getAttribute('title')).toMatch(/\d{4}/);
    noBadText();
  });

  it('cards show a designed cover (channel icon + subject) and no thumbnail iframe', async () => {
    mockTemplates([T1, T2, { id: 21, name: 'Push ping', channel: 'push', status: 'rejected' }], 3);
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    for (const name of ['Day 1 Welcome', 'WA Promo', 'Push ping']) {
      const c = card(name);
      expect(c.querySelector('iframe')).toBeNull();
      const cover = within(c).getByTestId('card-cover');
      expect(cover.querySelector('svg')).toBeTruthy();
      expect(cover.textContent?.trim()).not.toBe('');
    }
    expect(within(card('Day 1 Welcome')).getByTestId('card-cover').textContent).toContain('Welcome!');
    expect(within(card('WA Promo')).getByTestId('card-cover').textContent).toContain('Promo text');
    expect(within(card('Push ping')).getByTestId('card-cover').textContent).toContain('Push message');
    expect(within(card('Push ping')).getByTestId('card-cover').querySelector('[data-status]')?.getAttribute('title')).toBe('Rejected');
  });

  it('each card has exactly Preview, Edit and ⋯; Test send lives in the ⋯ menu', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    const names = within(card('Day 1 Welcome')).getAllByRole('button').map(b => b.getAttribute('aria-label') || b.textContent?.trim());
    expect(names).toEqual(['Preview', 'Edit', 'More actions for Day 1 Welcome']);
    expect(within(card('Day 1 Welcome')).queryByText(/Test send/i)).toBeNull();
    openMenu('Day 1 Welcome');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent);
    expect(items).toEqual(['Preview AI version', 'Email checks', 'Test send', 'Test send (select recipients)', 'Delete']);
    expect(menuItem('Test send (select recipients)')).toHaveProperty('disabled', true);
    expect(menuItem('Delete').className).toMatch(/danger/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    // WhatsApp templates have no email-only actions
    openMenu('WA Promo');
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Delete']);
  });

  it('renders the "no templates yet" empty state, and the table empty row', async () => {
    mockTemplates([], 0);
    render(<Content />);
    await screen.findByText('No templates yet');
    expect(bodyText()).toContain('Showing 0–0 of 0');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('No templates found')).toBeTruthy();
    noBadText();
  });

  it('shows a filtered empty state when a search matches nothing', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    mockTemplates([], 0);
    fireEvent.change(screen.getByPlaceholderText('Search name or subject…'), { target: { value: 'zzz' } });
    await screen.findByText('No templates found');
    expect(screen.queryByText('No templates yet')).toBeNull();
    noBadText();
  });

  it('shows skeleton cards on first load', async () => {
    vi.mocked(api.getTemplates).mockReturnValue(new Promise(() => {}));
    render(<Content />);
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeTruthy();
    await waitFor(() => expect(api.getTemplates).toHaveBeenCalled());
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeTruthy();
    noBadText();
  });

  it('shows an error state on getTemplates failure and retries', async () => {
    vi.mocked(api.getTemplates).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.authFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Content />);
    await screen.findByText("Couldn't load templates");
    expect(bodyText()).toContain('Showing 0–0 of 0');
    noBadText();
    mockTemplates();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Day 1 Welcome');
    expect(screen.queryByText("Couldn't load templates")).toBeNull();
  });

  it('channel chips, status filter, search and pagination send the right query params', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    const channels = screen.getByRole('group', { name: 'Channel' });
    fireEvent.click(within(channels).getByRole('button', { name: /^WhatsApp/ }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, channel: 'whatsapp' }));
    fireEvent.click(within(channels).getByRole('button', { name: /^All/ }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    // Plain status names in the filter
    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(within(status).getAllByRole('option').map(o => o.textContent)).toEqual(['All statuses', 'Draft', 'Waiting for approval', 'Approved', 'Rejected']);
    fireEvent.change(status, { target: { value: 'approved' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, status: 'approved' }));
    fireEvent.change(status, { target: { value: 'all' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    fireEvent.change(screen.getByPlaceholderText('Search name or subject…'), { target: { value: '  promo ' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'promo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 2, limit: 20 }));
    fireEvent.click(screen.getByTitle('Last page'));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 3, limit: 20 }));
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '50' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 50 }));
  });

  it('table view lists templates and persists the view mode', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('Segment')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('content.viewMode')).toBe('table');
    expect(screen.getByRole('button', { name: 'More actions for Day 1 Welcome' })).toBeTruthy();
    noBadText();
  });
});

describe('Templates page — editor and routes', () => {
  it('New template goes to /content/new, validates name and HTML, then calls createTemplate', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    expect(where()).toBe('/content/new');
    expect(screen.getByRole('heading', { level: 1, name: 'New template' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Message settings' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Preview' })).toBeTruthy();
    expect(screen.queryByText('Day 1 Welcome')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Template name is required');
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Sale Announcement'), { target: { value: '  Summer  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Please upload an HTML file');
    expect(api.createTemplate).not.toHaveBeenCalled();
    vi.mocked(api.createTemplate).mockResolvedValue(as(api.createTemplate, { data: { id: 99, name: 'Summer', channel: 'email', status: 'draft' } }));
    fireEvent.change(screen.getByPlaceholderText(/edit directly/), { target: { value: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>' } });
    expect(screen.getByText('{{ITEM_NAME}}')).toBeTruthy();
    expect(bodyText()).toContain('2 placeholders detected');
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledWith({
      name: 'Summer', channel: 'email', subject: null,
      body: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>', bodyPlain: 'Hi {{first_name}} {{ITEM_NAME}}',
      variables: ['first_name', 'ITEM_NAME'],
    }));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template created');
    await screen.findByText('Summer');
    expect(where()).toBe('/content');
    expect(bodyText()).toContain('of 46');
    noBadText();
  });

  it('editor: plain labels, optional sections collapsed, device toggle, and Cancel returns to /content', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    expect(screen.getByText('Subject line')).toBeTruthy();
    expect(screen.getByText(/Email content \(HTML\)/)).toBeTruthy();
    expect(screen.getByText('0 / 60 characters')).toBeTruthy();
    for (const d of document.querySelectorAll('details')) expect(d.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    expect(screen.queryByText(/\/ 60 characters/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Nothing to show yet')).toBeTruthy();
    const iframe = screen.getByTitle('template-preview');
    expect(iframe.getAttribute('sandbox')).toBe(SANDBOX);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Day 1 Welcome')).toBeTruthy();
    expect(where()).toBe('/content');
    noBadText();
  });

  it('shows a toast when saving fails', async () => {
    mockTemplates();
    vi.mocked(api.createTemplate).mockRejectedValue(new Error('Duplicate name'));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    fireEvent.change(await screen.findByPlaceholderText('e.g. Summer Sale Announcement'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText(/edit directly/), { target: { value: '<p>x</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Duplicate name'));
    expect(screen.getByRole('button', { name: 'Save template' })).toBeTruthy();
    expect(where()).toBe('/content/new');
  });

  it('Edit goes to /content/<id>, loads the full template and saves via updateTemplate', async () => {
    mockTemplates();
    vi.mocked(api.getTemplate).mockResolvedValue(as(api.getTemplate, { data: { id: 1, body: '<p>Full {{city}}</p>' } }));
    vi.mocked(api.updateTemplate).mockResolvedValue(as(api.updateTemplate, { data: { ...T1, name: 'Day 1 Updated' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(within(card('Day 1 Welcome')).getByRole('button', { name: 'Edit' }));
    expect(where()).toBe('/content/1');
    expect(screen.getByRole('heading', { level: 1, name: 'Day 1 Welcome' })).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(api.getTemplate).toHaveBeenCalledWith(1);
    await waitFor(() => expect((screen.getByPlaceholderText(/edit directly/) as HTMLTextAreaElement).value).toBe('<p>Full {{city}}</p>'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Day 1 Welcome', subject: 'Welcome!', variables: ['city'] })));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template updated');
    await screen.findByText('Day 1 Updated');
    expect(where()).toBe('/content');
  });

  it('/content/new (route page) renders the create editor', async () => {
    h.pathname = '/content/new';
    window.history.replaceState(null, '', '/content/new');
    mockTemplates();
    render(<NewTemplatePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'New template' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(where()).toBe('/content');
    await screen.findByText('Day 1 Welcome');
  });

  it('/content/7 (route page) loads template 7 into the edit editor', async () => {
    h.pathname = '/content/7';
    window.history.replaceState(null, '', '/content/7');
    mockTemplates();
    vi.mocked(api.getTemplate).mockResolvedValue(as(api.getTemplate, { data: { id: 7, name: 'Day 7 Goodbye', channel: 'email', status: 'draft', subject: 'Bye', body: '<p>Bye {{city}}</p>' } }));
    render(<EditTemplatePage />);
    expect(screen.getByRole('status', { name: 'Loading template' })).toBeTruthy();
    await screen.findByRole('heading', { level: 1, name: 'Day 7 Goodbye' });
    expect(api.getTemplate).toHaveBeenCalledWith(7);
    expect(api.getTemplate).toHaveBeenCalledTimes(1);
    expect((screen.getByPlaceholderText(/edit directly/) as HTMLTextAreaElement).value).toBe('<p>Bye {{city}}</p>');
    expect((screen.getByPlaceholderText('e.g. Your Exclusive Offer Awaits') as HTMLInputElement).value).toBe('Bye');
    vi.mocked(api.updateTemplate).mockResolvedValue(as(api.updateTemplate, { data: { id: 7, name: 'Day 7 Goodbye', channel: 'email', status: 'draft' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'Day 7 Goodbye', body: '<p>Bye {{city}}</p>' })));
    noBadText();
  });

  it('an invalid id shows the library with a "Template not found" toast', async () => {
    h.pathname = '/content/abc';
    window.history.replaceState(null, '', '/content/abc');
    mockTemplates();
    render(<EditTemplatePage />);
    await screen.findByText('Day 1 Welcome');
    expect(h.toastError).toHaveBeenCalledWith('Template not found');
    expect(api.getTemplate).not.toHaveBeenCalled();
    expect(where()).toBe('/content');
  });

  it('an id that does not load shows the library with a "Template not found" toast', async () => {
    h.pathname = '/content/999';
    window.history.replaceState(null, '', '/content/999');
    mockTemplates();
    vi.mocked(api.getTemplate).mockRejectedValue(new Error('HTTP 404'));
    render(<EditTemplatePage />);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Template not found'));
    await screen.findByText('Day 1 Welcome');
    expect(where()).toBe('/content');
  });
});

describe('Templates page — actions', () => {
  it('delete is in the ⋯ menu, asks for confirmation, calls deleteTemplate and updates the count', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Delete'));
    expect(screen.getByRole('alertdialog', { name: 'Delete template' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteTemplate).not.toHaveBeenCalled();
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Delete'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteTemplate).toHaveBeenCalledWith(1));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template deleted');
    await waitFor(() => expect(screen.queryByText('Day 1 Welcome')).toBeNull());
    expect(bodyText()).toContain('of 44');
    expect(bodyText()).toContain('44 templates');
  });

  it('delete failure shows an error toast and keeps the template', async () => {
    mockTemplates();
    vi.mocked(api.deleteTemplate).mockRejectedValue(new Error('In use by a journey'));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Delete'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('In use by a journey'));
    expect(screen.getAllByText('Day 1 Welcome').length).toBeGreaterThan(0);
  });

  it('Preview opens a right-side drawer with a sandboxed iframe, Edit and Test send', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Rendered</p>' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(within(card('Day 1 Welcome')).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledWith(1));
    const drawer = await screen.findByRole('dialog', { name: 'Preview of Day 1 Welcome' });
    await waitFor(() => expect(drawer.querySelector('iframe')?.getAttribute('sandbox')).toBe(SANDBOX));
    expect(drawer.textContent).toContain('Email · Everyone · Approved');
    expect(within(drawer).getByRole('button', { name: /Edit/ })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: /Test send/ })).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Mobile' }));
    expect(within(drawer).getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed')).toBe('true');
    expect(drawer.querySelector('iframe')?.getAttribute('sandbox')).toBe(SANDBOX);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    noBadText();
  });

  it('clicking the card itself opens the preview drawer; Edit in the drawer opens the editor', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Promo</p>' } }));
    render(<Content />);
    await screen.findByText('WA Promo');
    fireEvent.click(screen.getByText('Promo text'));
    const drawer = await screen.findByRole('dialog', { name: 'Preview of WA Promo' });
    expect(api.previewTemplate).toHaveBeenCalledWith(20);
    expect(within(drawer).queryByRole('button', { name: /Test send/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(card('WA Promo'), { key: 'Enter' });
    const again = await screen.findByRole('dialog', { name: 'Preview of WA Promo' });
    fireEvent.click(within(again).getByRole('button', { name: /Edit/ }));
    expect(where()).toBe('/content/20');
    expect(screen.getByRole('heading', { level: 1, name: 'WA Promo' })).toBeTruthy();
  });

  it('AI preview is in the ⋯ menu for Day 1-7 email templates and calls previewTemplateAI', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplateAI).mockResolvedValue(as(api.previewTemplateAI, { data: { html: '<p>AI</p>' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Preview AI version'));
    await waitFor(() => expect(api.previewTemplateAI).toHaveBeenCalledWith(1));
    await screen.findByRole('dialog', { name: 'Preview of Day 1 Welcome' });
  });

  it('Email checks shows the "no checks yet" message when nothing is stored', async () => {
    mockTemplates();
    vi.mocked(api.getStoredQaReport).mockResolvedValue(as(api.getStoredQaReport, {}));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Email checks'));
    await screen.findByText(/No checks yet/);
    expect(api.getStoredQaReport).toHaveBeenCalledWith(1);
    expect(screen.getByRole('dialog', { name: 'Email checks' })).toBeTruthy();
    expect(bodyText()).not.toMatch(/\bQA\b/);
  });

  it('renders stored email checks without NaN/undefined', async () => {
    mockTemplates();
    vi.mocked(api.getStoredQaReport).mockResolvedValue(as(api.getStoredQaReport, { data: {
      subject: 'Welcome!', grammar: ['Typo: recieve'], missingContent: [], errors: [],
      urls: { results: [{ ok: true, status: 200, url: 'https://a.com' }] },
      spamRisk: { level: 'Low' }, placement: { available: true, placement: 'inbox' },
    } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Email checks'));
    await screen.findByText('Typo: recieve');
    expect(screen.getByText('Inbox — not spam')).toBeTruthy();
    expect(bodyText()).toContain('Links (0 found, 0 broken)');
    expect(screen.getByText('https://a.com')).toBeTruthy();
    noBadText();
  });

  it('Test send in the ⋯ menu sends to the test inbox and runs the email checks', async () => {
    mockTemplates();
    vi.mocked(api.sendTestDay).mockResolvedValue(as(api.sendTestDay, { sent: 1 }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    fireEvent.click(menuItem('Test send'));
    await waitFor(() => expect(api.sendTestDay).toHaveBeenCalledWith(1, [ROCKY]));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('Sent Day 1 Welcome to 1 recipient(s)'));
    await waitFor(() => expect(api.analyzeTestEmail).toHaveBeenCalledWith(1));
    expect(screen.getByRole('dialog', { name: 'Email checks' })).toBeTruthy();
  });
});

describe('Templates page — tabs', () => {
  it('Waiting for approval: queue, review panel and approve (reusing the list and approve APIs)', async () => {
    const P = { id: 30, name: 'Pending Offer', channel: 'email', status: 'pending_approval', subject: 'Big sale' };
    mockLists([T1, P], [P]);
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Offer</p>' } }));
    vi.mocked(api.approveTemplate).mockResolvedValue(as(api.approveTemplate, { data: { ...P, status: 'approved' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(sectionTab(/Waiting for approval/).textContent).toBe('Waiting for approval 1');
    expect(bodyText()).toContain('1 waiting for approval');
    fireEvent.click(sectionTab(/Waiting for approval/));
    expect(where()).toBe('/content?tab=approval');
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, status: 'pending_approval' }));
    const queue = await screen.findByRole('list', { name: 'Waiting for approval' });
    expect(within(queue).getByText('Pending Offer')).toBeTruthy();
    expect(within(queue).queryByText('Day 1 Welcome')).toBeNull();
    fireEvent.click(within(queue).getByRole('button', { name: 'Review' }));
    const aside = await screen.findByRole('complementary', { name: 'Pending Offer' });
    expect(aside.textContent).toContain('Approval review · 1 of 1');
    expect(aside.textContent).toContain('Subject: Big sale');
    await waitFor(() => expect(aside.querySelector('iframe')?.getAttribute('sandbox')).toBe(SANDBOX));
    fireEvent.click(screen.getByRole('button', { name: 'Approve template' }));
    await waitFor(() => expect(api.approveTemplate).toHaveBeenCalledWith(30));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template approved');
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(screen.getByText('Nothing is waiting for approval')).toBeTruthy();
    expect(sectionTab(/Waiting for approval/).textContent).toBe('Waiting for approval');
    noBadText();
  });

  it('review panel rejects and surfaces errors', async () => {
    const P = { id: 31, name: 'WA Pending', channel: 'whatsapp', status: 'pending_approval', body_plain: 'Hi there' };
    mockLists([P], [P]);
    vi.mocked(api.rejectTemplate).mockRejectedValueOnce(new Error('Not allowed'));
    render(<Content />);
    await screen.findAllByText('WA Pending');
    fireEvent.click(sectionTab(/Waiting for approval/));
    const queue = await screen.findByRole('list', { name: 'Waiting for approval' });
    fireEvent.click(within(queue).getByRole('button', { name: 'Review' }));
    const aside = await screen.findByRole('complementary', { name: 'WA Pending' });
    expect(aside.textContent).toContain('Hi there');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Not allowed'));
    expect(screen.getByRole('complementary')).toBeTruthy();
    vi.mocked(api.rejectTemplate).mockResolvedValue(as(api.rejectTemplate, {}));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('Template rejected'));
    expect(api.rejectTemplate).toHaveBeenCalledWith(31);
    expect(api.previewTemplate).not.toHaveBeenCalled();
    fireEvent.click(sectionTab(/Library/));
    await screen.findByText('Rejected');
  });

  it('the preview drawer offers Approve / Reject for a pending template', async () => {
    const P = { id: 32, name: 'Pending Mail', channel: 'email', status: 'pending_approval', subject: 'Hi' };
    mockLists([P], [P]);
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Hi</p>' } }));
    vi.mocked(api.approveTemplate).mockResolvedValue(as(api.approveTemplate, { data: { ...P, status: 'approved' } }));
    render(<Content />);
    await screen.findByText('Pending Mail');
    fireEvent.click(within(card('Pending Mail')).getByRole('button', { name: 'Preview' }));
    const drawer = await screen.findByRole('dialog', { name: 'Preview of Pending Mail' });
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.approveTemplate).toHaveBeenCalledWith(32));
    await waitFor(() => expect(drawer.textContent).toContain('Approved'));
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('Testing tab loads test-send contacts and email tracking-flow stats via authFetch', async () => {
    mockTemplates();
    vi.mocked(api.authFetch).mockImplementation((url: string) => {
      if (url.includes('/test-sends/contacts')) return Promise.resolve(jsonResponse({ data: { contacts: [{ email: 'r@x.com', name: 'Rocky', country: 'UAE' }], total: 1 } }));
      if (url.includes('/send-log/summary')) return Promise.resolve(jsonResponse({ data: { byStatus: [{ status: 'sent', count: '5' }, { status: 'opened', count: '3' }, { status: 'clicked', count: '2' }, { status: 'failed', count: '1' }] } }));
      return Promise.resolve(jsonResponse({ data: { total: 4 } }));
    });
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(sectionTab(/Testing/));
    expect(where()).toBe('/content?tab=testing');
    await screen.findByText('r@x.com');
    const row = screen.getByTestId('recipient-row');
    expect(within(row).getByText('Rocky')).toBeTruthy();
    expect(within(row).getByText('r@x.com')).toBeTruthy();
    expect(within(row).getByText('UAE')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Website visits tracked').previousElementSibling?.textContent).toBe('4'));
    expect(screen.getByText('Sent').previousElementSibling?.textContent).toBe('10');
    expect(screen.getByText('Opened').previousElementSibling?.textContent).toBe('5');
    expect(screen.getByText('Failed').previousElementSibling?.textContent).toBe('1');
    // Selecting a recipient enables "Test send to 1 selected" in the card menu
    fireEvent.click(screen.getByRole('checkbox'));
    expect(bodyText()).toContain('1 selected of 1');
    fireEvent.click(sectionTab(/Library/));
    expect(where()).toBe('/content');
    await screen.findByText('Day 1 Welcome');
    openMenu('Day 1 Welcome');
    const sel = menuItem('Test send to 1 selected');
    expect(sel).toHaveProperty('disabled', false);
    vi.mocked(api.sendTestDay).mockResolvedValue(as(api.sendTestDay, { sent: 1 }));
    fireEvent.click(sel);
    await waitFor(() => expect(api.sendTestDay).toHaveBeenCalledWith(1, ['r@x.com']));
    noBadText();
  });

  it('testing tools tabs switch between the channel sub-panels', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(sectionTab(/Testing/));
    const tools = screen.getByRole('tablist', { name: 'Testing tools' });
    expect(screen.getByText('Email tracking flow')).toBeTruthy();
    fireEvent.click(within(tools).getByRole('tab', { name: 'SMS' }));
    expect(screen.queryByText('Email tracking flow')).toBeNull();
    expect(within(tools).getByRole('tab', { name: 'SMS' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(tools).getByRole('tab', { name: 'Email' }));
    expect(screen.getByText('Email tracking flow')).toBeTruthy();
  });

  it('opening /content does not load the Testing data; opening Testing loads it once and keeps it', async () => {
    mockTemplates();
    const urls: string[] = [];
    vi.mocked(api.authFetch).mockImplementation((url: string) => {
      urls.push(url);
      if (url.includes('/test-sends/contacts')) return Promise.resolve(jsonResponse({ data: { contacts: [], total: 0 } }));
      return Promise.resolve(jsonResponse({ data: {} }));
    });
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    await new Promise(r => setTimeout(r, 400));
    expect(urls).toEqual([]);
    fireEvent.click(sectionTab(/Testing/));
    await waitFor(() => expect(urls.some(u => u.includes('/test-sends/contacts'))).toBe(true));
    const count = (part: string) => urls.filter(u => u.includes(part)).length;
    expect(count('/send-log/summary')).toBe(1);
    expect(count('/utm-log')).toBe(1);
    expect(count('/test-sends/contacts')).toBe(1);
    await screen.findByText('Type at least 2 characters to search');
    fireEvent.click(sectionTab(/Library/));
    fireEvent.click(sectionTab(/Testing/));
    await new Promise(r => setTimeout(r, 400));
    expect(count('/send-log/summary')).toBe(1);
    expect(count('/utm-log')).toBe(1);
    expect(count('/test-sends/contacts')).toBe(1);
  });

  it('recipient rows keep name and email together, and counts use thousands separators', async () => {
    mockTemplates();
    vi.mocked(api.authFetch).mockImplementation((url: string) => {
      if (url.includes('/test-sends/contacts')) {
        return Promise.resolve(jsonResponse({ data: { contacts: [
          { id: 1, email: 'a.very.long.address.0000000@gmail.com', name: 'Asha Rao', contact_type: 'B2C' },
          { id: 2, email: 'b@x.com' },
        ], total: '1691460' } }));
      }
      return Promise.resolve(jsonResponse({ data: {} }));
    });
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(sectionTab(/Testing/));
    await screen.findByText('Asha Rao');
    const rows = screen.getAllByTestId('recipient-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Asha Rao')).toBeTruthy();
    expect(within(rows[0]).getByText('a.very.long.address.0000000@gmail.com')).toBeTruthy();
    expect(within(rows[0]).getByRole('checkbox')).toBeTruthy();
    expect(bodyText()).toContain('0 selected of 1,691,460');
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }));
    expect(bodyText()).toContain('2 selected of 1,691,460');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(bodyText()).toContain('0 selected of 1,691,460');
    mockTemplates();
    vi.mocked(api.authFetch).mockImplementation(() => Promise.resolve(jsonResponse({ data: { contacts: [], total: 0 } })));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter test recipients' }), { target: { value: 'zz' } });
    await screen.findByText('No contacts found');
    noBadText();
  });

  it('opens the tab named in ?tab= and keeps the URL in sync', async () => {
    window.history.replaceState(null, '', '/content?tab=testing');
    mockTemplates();
    render(<Content />);
    await waitFor(() => expect(sectionTab(/Testing/).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tabpanel', { name: 'Testing' })).toBeTruthy();
    expect(screen.getByText('Email tracking flow')).toBeTruthy();
    fireEvent.click(sectionTab(/Waiting for approval/));
    expect(where()).toBe('/content?tab=approval');
    fireEvent.click(sectionTab(/Library/));
    expect(where()).toBe('/content');
    // An unknown tab falls back to the library
    cleanup();
    window.history.replaceState(null, '', '/content?tab=nope');
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(sectionTab(/Library/).getAttribute('aria-selected')).toBe('true');
  });
});
