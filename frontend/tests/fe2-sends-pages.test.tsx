// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import TestSendsPage from '@/app/(dashboard)/test-sends/page';
import SchedulerPage from '@/app/(dashboard)/test-sends/scheduler/page';
import EmailLogPage from '@/app/(dashboard)/test-sends/emaillog/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/test-sends',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

/* ── authFetch router ─────────────────────────────────────────── */
type Reply = { status?: number; body: unknown } | Error | 'pending';
type Handler = (url: string, init?: RequestInit) => Reply;
let routes: [RegExp, Reply | Handler][] = [];
const route = (re: RegExp, r: Reply | Handler): void => { routes.unshift([re, r]); };

const respond = (r: { status?: number; body: unknown }): Response => {
  const status = r.status ?? 200;
  return { ok: status >= 200 && status < 300, status, json: async () => r.body } as unknown as Response;
};

const calls = (re: RegExp): { url: string; body?: unknown }[] =>
  vi.mocked(api.authFetch).mock.calls
    .filter(([u]) => re.test(u))
    .map(([u, init]) => ({ url: u, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined }));

let alertMock: ReturnType<typeof vi.fn<(msg?: string) => void>>;

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  routes = [];
  vi.mocked(api.authFetch).mockImplementation((url: string, init?: RequestInit) => {
    const hit = routes.find(([re]) => re.test(url));
    let r: Reply = { body: {} };
    if (hit) r = typeof hit[1] === 'function' ? hit[1](url, init) : hit[1];
    if (r === 'pending') return new Promise<Response>(() => {});
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(respond(r));
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('real network not allowed'))));
  alertMock = vi.fn<(msg?: string) => void>();
  vi.stubGlobal('alert', alertMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const noJunk = (): void => { expect(bodyText()).not.toMatch(/NaN|undefined|Invalid Date/); };

const CONTACTS = [
  { id: 1, email: 'a@x.com', name: 'Alice', country: 'UAE', contact_type: 'b2c', booking_status: 'CONFIRMED' },
  { id: 2, email: 'b@x.com', name: 'Bob', country: 'India' },
  { id: 3, email: 'c@x.com' },
];
const FILTER_OPTS = {
  booking_status: ['CONFIRMED', 'CANCELLED'], contact_type: ['b2c', 'b2b'],
  countries: [{ val: 'UAE', cnt: 1200 }], geography: ['GCC'], product_tier: ['gold'],
  segments: [{ id: 7, name: 'Loyal' }], custom_segments: [{ id: 9, name: 'VIP' }],
};

/* ═══════════════════ Test Sends ═══════════════════ */
describe('Test Sends page', () => {
  const typical = (): void => {
    route(/send-log\/summary/, { body: { data: { byStatus: [
      { status: 'sent', count: '6' }, { status: 'opened', count: '3' }, { status: 'clicked', count: '1' }, { status: 'failed', count: '2' },
    ] } } });
    route(/utm-log/, { body: { data: { total: 4 } } });
    route(/schedule\/list/, { body: { data: [{ is_running: true }, { is_running: false }] } });
    route(/contacts\/filter-options/, { body: { data: FILTER_OPTS } });
    route(/\/contacts\?/, { body: { data: { contacts: CONTACTS, total: 3 } } });
  };

  it('renders contacts, flow stats, schedule badge and 7 templates', async () => {
    typical();
    render(<TestSendsPage />);
    await screen.findByText('a@x.com');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(bodyText()).toContain('0 selected of 3 contacts');
    // sent = 6+3+1, opened = 3+1, clicked = 1
    await waitFor(() => expect(screen.getByText('10')).toBeTruthy());
    expect(screen.getAllByText('40%')).toHaveLength(2);
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.getAllByText(/^Day \d$/)).toHaveLength(7);
    expect(screen.getByText('Scheduler Mail').parentElement?.textContent).toContain('1');
    noJunk();
  });

  it('shows empty states with no data', async () => {
    route(/\/contacts\?/, { body: { data: { contacts: [], total: 0 } } });
    render(<TestSendsPage />);
    await waitFor(() => expect(calls(/\/contacts\?/).length).toBeGreaterThan(0));
    await screen.findByText('No contacts found');
    expect(bodyText()).toContain('0 selected of 0 contacts');
    expect(screen.queryByText(/%$/)).toBeNull();
    for (const b of screen.getAllByRole('button', { name: /Send \(0\)/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
    noJunk();
  });

  it('survives every API failing', async () => {
    route(/.*/, new TypeError('Failed to fetch'));
    route(/schedule\/list/, { status: 500, body: { error: 'boom' } });
    render(<TestSendsPage />);
    await waitFor(() => expect(calls(/\/contacts\?/).length).toBeGreaterThan(0));
    await screen.findByText('No contacts found');
    expect(screen.getByText('Test Sends')).toBeTruthy();
    noJunk();
  });

  it('shows loading spinner while contacts load', async () => {
    route(/\/contacts\?/, 'pending');
    const { container } = render(<TestSendsPage />);
    await waitFor(() => expect(container.querySelector('.spin')).not.toBeNull());
    expect(screen.queryByText('No contacts found')).toBeNull();
  });

  it('debounces search and sends q only for 2+ chars', async () => {
    typical();
    render(<TestSendsPage />);
    await screen.findByText('a@x.com');
    fireEvent.change(screen.getByPlaceholderText('Filter by email or name...'), { target: { value: 'al' } });
    await waitFor(() => expect(calls(/\/contacts\?.*q=al/).length).toBe(1));
  });

  it('selects a contact and sends a template with the selected emails', async () => {
    typical();
    route(/test-sends\/day1$/, { body: { data: { results: [{ success: true, email: 'a@x.com', ms: 120 }, { success: false, email: 'z@x.com', error: 'bounced' }], ranking: { source: 'web', themes: ['A', 'B', 'C', 'D'] } } } });
    render(<TestSendsPage />);
    fireEvent.click(await screen.findByText('a@x.com'));
    expect(bodyText()).toContain('1 selected of 3 contacts');
    fireEvent.click(screen.getAllByRole('button', { name: /Send \(1\)/ })[0]);
    await screen.findByText(/Sent to 2 recipients/);
    expect(calls(/test-sends\/day1$/)[0].body).toEqual({ emails: ['a@x.com'] });
    expect(bodyText()).toContain('A · B · C');
    expect(bodyText()).toContain('120ms');
    expect(bodyText()).toContain('bounced');
  });

  it('day 6 sends the chosen destination', async () => {
    typical();
    render(<TestSendsPage />);
    fireEvent.click(await screen.findByText('b@x.com'));
    fireEvent.change(screen.getByDisplayValue('Singapore'), { target: { value: 'kuala_lumpur' } });
    expect(screen.getByDisplayValue('Kuala Lumpur')).toBeTruthy();
    const btn = screen.getAllByRole('button', { name: /Send \(1\)/ })[5];
    fireEvent.click(btn);
    await waitFor(() => expect(calls(/test-sends\/day6$/)).toHaveLength(1));
    expect(calls(/test-sends\/day6$/)[0].body).toEqual({ emails: ['b@x.com'], destinationKey: 'kuala_lumpur' });
  });

  it('shows the error when a send fails', async () => {
    typical();
    route(/test-sends\/day2$/, { status: 502, body: { error: 'SMTP down' } });
    render(<TestSendsPage />);
    fireEvent.click(await screen.findByText('a@x.com'));
    fireEvent.click(screen.getAllByRole('button', { name: /Send \(1\)/ })[1]);
    await screen.findByText('SMTP down');
  });

  // BUG: app/(dashboard)/test-sends/page.tsx:679 renders `${r.ms}ms` for a successful
  // recipient even when the API omits `ms`, producing the text "undefinedms".
  it('does not render "undefinedms" when a successful result has no ms', async () => {
    typical();
    route(/test-sends\/day1$/, { body: { data: { results: [{ success: true, email: 'a@x.com' }] } } });
    render(<TestSendsPage />);
    fireEvent.click(await screen.findByText('a@x.com'));
    fireEvent.click(screen.getAllByRole('button', { name: /Send \(1\)/ })[0]);
    await screen.findByText(/Sent to 1 recipients/);
    expect(bodyText()).not.toContain('undefined');
  });

  it('filters: changing a dropdown refetches with the filter; select-all dedupes; clear-all resets', async () => {
    typical();
    render(<TestSendsPage />);
    await screen.findByText('a@x.com');
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await screen.findByText('Booking Status');
    expect(screen.getByText('UAE (1,200)')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'CONFIRMED' } });
    await waitFor(() => expect(calls(/booking_status=CONFIRMED/).length).toBeGreaterThan(0));
    route(/limit=3&/, { body: { data: { contacts: [...CONTACTS, { id: 4, email: 'a@x.com' }], total: 4 } } });
    fireEvent.click(screen.getByRole('button', { name: /Select All 3 Filtered/ }));
    await waitFor(() => expect(bodyText()).toContain('3 selected of 3 contacts'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(bodyText()).toContain('0 selected of 3 contacts');
  });

  it('loads more contacts with the next offset', async () => {
    typical();
    route(/\/contacts\?/, (url) => url.includes('offset=50')
      ? { body: { data: { contacts: [{ id: 99, email: 'more@x.com' }], total: 60 } } }
      : { body: { data: { contacts: CONTACTS, total: 60 } } });
    render(<TestSendsPage />);
    const more = await screen.findByText('Load more (57 remaining)');
    fireEvent.click(more);
    await screen.findByText('more@x.com');
  });
});

/* ═══════════════════ Scheduler ═══════════════════ */
describe('Scheduler page', () => {
  const SCHED = {
    id: 11, is_running: true, emails: ['a@x.com', 'b@x.com'], started_at: '2026-10-01T10:00:00Z',
    last_sent_day: 2, last_sent_at: '2026-10-02T10:00:00Z', next_day_to_send: 3,
    prewarm: { status: 'ready', readyCount: 7, summary: [{ day: 1, status: 'ready' }, { day: 2, status: 'failed' }] },
  };
  const typical = (): void => {
    route(/schedule\/list/, { body: { data: [SCHED, { id: 12, is_running: false, emails: [] }] } });
    route(/contacts\/filter-options/, { body: { data: FILTER_OPTS } });
    route(/\/contacts\?/, { body: { data: { contacts: CONTACTS, total: 3 } } });
  };

  it('renders contacts and schedule cards', async () => {
    typical();
    render(<SchedulerPage />);
    await screen.findByText('Schedule #11');
    expect(screen.getByText('Schedule #12')).toBeTruthy();
    expect(screen.getByText('1 RUNNING')).toBeTruthy();
    expect(screen.getByText('STOPPED')).toBeTruthy();
    expect(bodyText()).toContain('AI content ready — 7/7 days cached');
    expect(bodyText()).toContain('D1✓');
    expect(bodyText()).toContain('D2✗');
    await screen.findByText('Alice');
    noJunk();
  });

  it('shows empty states', async () => {
    route(/\/contacts\?/, { body: { data: { contacts: [], total: 0 } } });
    render(<SchedulerPage />);
    await screen.findByText(/No schedules yet/);
    await screen.findByText('No contacts found');
    expect((screen.getByRole('button', { name: /New Schedule/ }) as HTMLButtonElement).disabled).toBe(true);
    noJunk();
  });

  it('survives API failures', async () => {
    route(/.*/, new TypeError('Failed to fetch'));
    render(<SchedulerPage />);
    await waitFor(() => expect(calls(/schedule\/list/).length).toBeGreaterThan(0));
    await screen.findByText('No contacts found');
    expect(screen.getByText(/No schedules yet/)).toBeTruthy();
  });

  it('shows the contact loading spinner', async () => {
    route(/\/contacts\?/, 'pending');
    const { container } = render(<SchedulerPage />);
    await waitFor(() => expect(container.querySelector('.spin')).not.toBeNull());
  });

  it('starts a new schedule with selected emails', async () => {
    typical();
    route(/schedule\/start/, { body: { data: { id: 20, is_running: true, emails: ['a@x.com'] } } });
    render(<SchedulerPage />);
    fireEvent.click(await screen.findByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /New Schedule/ }));
    await screen.findByText('Schedule #20');
    expect(calls(/schedule\/start/)[0].body).toEqual({ destinationKey: 'singapore', loop: false, emails: ['a@x.com'] });
  });

  it('alerts when start fails', async () => {
    typical();
    route(/schedule\/start/, { status: 400, body: { error: 'too many' } });
    render(<SchedulerPage />);
    fireEvent.click(await screen.findByText('Alice'));
    fireEvent.click(screen.getByRole('button', { name: /New Schedule/ }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Start failed: too many'));
  });

  it('stop, send-now (tick) and remove email call the right endpoints', async () => {
    typical();
    route(/schedule\/11\/stop/, { body: { data: { ...SCHED, is_running: false } } });
    route(/schedule\/11\/tick/, { body: { data: { day: 3, label: 'Visa Hub', sentTo: 2, sequenceDone: false } } });
    route(/schedule\/11\/remove-email/, { body: { data: { ...SCHED, emails: ['a@x.com'] } } });
    render(<SchedulerPage />);
    await screen.findByText('Schedule #11');
    fireEvent.click(screen.getByRole('button', { name: /Send Now/ }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Day 3 (Visa Hub) sent to 2'));
    const removeIcon = screen.getAllByText('b@x.com').map(e => e.querySelector('svg')).find(Boolean) as SVGElement;
    fireEvent.click(removeIcon);
    await waitFor(() => expect(calls(/remove-email/)[0]?.body).toEqual({ email: 'b@x.com' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(screen.getAllByText('STOPPED')).toHaveLength(2));
  });

  it('tick reports skipped', async () => {
    typical();
    route(/schedule\/11\/tick/, { body: { data: { skipped: true } } });
    render(<SchedulerPage />);
    await screen.findByText('Schedule #11');
    fireEvent.click(screen.getByRole('button', { name: /Send Now/ }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Skipped: unknown'));
  });

  it('opens the log modal with rows, empty, and closes', async () => {
    typical();
    route(/schedule\/11\/logs/, { body: { data: [
      { id: 1, email: 'a@x.com', status: 'opened', day_number: 1, sent_at: '2026-10-01T10:00:00Z', opened_at: '2026-10-01T11:00:00Z', duration_ms: 50 },
      { id: 2, email: 'b@x.com', status: 'failed', day_number: 1, sent_at: null, opened_at: null, duration_ms: null },
    ] } });
    route(/schedule\/12\/logs/, { body: { data: [] } });
    render(<SchedulerPage />);
    await screen.findByText('Schedule #11');
    fireEvent.click(screen.getAllByRole('button', { name: /View Logs/ })[0]);
    await screen.findByText('2 entries');
    expect(screen.getByText('50ms')).toBeTruthy();
    noJunk();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(calls(/schedule\/11\/logs/)).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: /View Logs/ })[1]);
    await screen.findByText('No send log entries found for this schedule yet.');
  });

  // BUG: app/(dashboard)/test-sends/scheduler/page.tsx:721 puts `…` directly in JSX
  // text, where escapes are not processed, so the UI shows the literal "Loading logs…".
  it('log modal loading text renders an ellipsis, not a literal \\u2026', async () => {
    typical();
    route(/schedule\/11\/logs/, 'pending');
    render(<SchedulerPage />);
    await screen.findByText('Schedule #11');
    fireEvent.click(screen.getAllByRole('button', { name: /View Logs/ })[0]);
    await screen.findByText(/Loading logs/);
    expect(bodyText()).not.toContain('\\u2026');
  });

  // BUG: app/(dashboard)/test-sends/scheduler/page.tsx:618 interpolates prewarm.readyCount
  // without a fallback, showing "undefined/7 days cached" when the API omits it.
  it('prewarm ready without readyCount does not render "undefined"', async () => {
    route(/schedule\/list/, { body: { data: [{ id: 5, is_running: true, prewarm: { status: 'ready' } }] } });
    render(<SchedulerPage />);
    await screen.findByText('Schedule #5');
    expect(bodyText()).not.toContain('undefined');
  });

  // BUG: app/(dashboard)/test-sends/scheduler/page.tsx:594 calls new Date(last_sent_at!)
  // even when last_sent_at is null, which renders "Invalid Date" / epoch time.
  it('last_sent_day without last_sent_at does not render a bogus time', async () => {
    route(/schedule\/list/, { body: { data: [{ id: 6, is_running: true, last_sent_day: 1, last_sent_at: null }] } });
    render(<SchedulerPage />);
    await screen.findByText('Schedule #6');
    const last = screen.getByText(/Last: Day 1/).textContent ?? '';
    expect(last).toMatch(/Last: Day 1 · $/);
  });

  // BUG: app/(dashboard)/test-sends/scheduler/page.tsx:432-436 — the "load more" row is
  // rendered with no content, so users see an empty clickable strip with no label.
  it('load-more row has a visible label', async () => {
    route(/\/contacts\?/, { body: { data: { contacts: CONTACTS, total: 80 } } });
    render(<SchedulerPage />);
    await screen.findByText('Alice');
    expect(screen.getByText(/Load more/)).toBeTruthy();
  });

  it('filter change refetches, clear filters resets, select-all selects deduped', async () => {
    typical();
    render(<SchedulerPage />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    await screen.findByText('Custom Segment');
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: '9' } });
    await waitFor(() => expect(calls(/custom_segment_id=9/).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /^Filters \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull());
    route(/limit=50000/, { body: { data: { contacts: [...CONTACTS, { id: 8, email: 'A@X.com' }], total: 4 } } });
    fireEvent.click(screen.getByRole('button', { name: /Select All 3 Filtered/ }));
    await waitFor(() => expect(bodyText()).toContain('3 selected of 3 contacts'));
  });

  it('alerts when select-all fails', async () => {
    typical();
    render(<SchedulerPage />);
    await screen.findByText('Alice');
    route(/limit=50000/, { status: 500, body: {} });
    fireEvent.click(screen.getByRole('button', { name: /Select All 3 Filtered/ }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('Failed to select all: HTTP 500'));
  });
});

/* ═══════════════════ Email log ═══════════════════ */
describe('Email log page', () => {
  const row = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, email: `u${id}@x.com`, contact_name: null, template_label: null, status: 'sent',
    sent_at: '2026-10-01T10:00:00Z', opened_at: null, clicked_at: null, duration_ms: 12, ...extra,
  });

  it('renders rows with typical data', async () => {
    route(/send-log\?/, { body: { data: { rows: [row(1, { contact_name: 'Uma', template_label: 'Welcome', status: 'clicked', clicked_at: '2026-10-01T11:00:00Z', opened_at: '2026-10-01T10:30:00Z' }), row(2, { status: 'weird', duration_ms: null, sent_at: null })], total: 2, page: 1 } } });
    render(<EmailLogPage />);
    await screen.findByText('u1@x.com');
    expect(screen.getByText('Uma')).toBeTruthy();
    expect(screen.getByText('2 records')).toBeTruthy();
    expect(screen.getByText('12ms')).toBeTruthy();
    expect(screen.queryByText(/^Page /)).toBeNull();
    noJunk();
  });

  it('shows empty state', async () => {
    route(/send-log\?/, { body: { data: { rows: [], total: 0 } } });
    render(<EmailLogPage />);
    await screen.findByText('No send logs found.');
    expect(screen.queryByText(/record/)).toBeNull();
    noJunk();
  });

  it('shows empty state on API error', async () => {
    route(/send-log\?/, { status: 500, body: { error: 'db down' } });
    render(<EmailLogPage />);
    await waitFor(() => expect(calls(/send-log\?/).length).toBe(1));
    await screen.findByText('No send logs found.');
  });

  it('shows the spinner while loading', async () => {
    route(/send-log\?/, 'pending');
    const { container } = render(<EmailLogPage />);
    await waitFor(() => expect(container.querySelector('.spin')).not.toBeNull());
  });

  it('search and status filters are sent as query params', async () => {
    route(/send-log\?/, { body: { data: { rows: [row(1)], total: 1, page: 1 } } });
    render(<EmailLogPage />);
    await screen.findByText('u1@x.com');
    expect(screen.getByText('1 record')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search by email...'), { target: { value: '  bob ' } });
    await waitFor(() => expect(calls(/email=bob/).length).toBe(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'failed' } });
    await waitFor(() => expect(calls(/email=bob&status=failed/).length).toBe(1));
  });

  it('paginates with Prev/Next and refreshes current page', async () => {
    route(/send-log\?/, (url) => {
      const p = Number(new URL(url).searchParams.get('page'));
      return { body: { data: { rows: [row(p * 100)], total: 45, page: p } } };
    });
    render(<EmailLogPage />);
    await screen.findByText('Page 1 of 3');
    const prev = screen.getByRole('button', { name: /Prev/ }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText('Page 2 of 3');
    expect(screen.getByText('u200@x.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText('Page 3 of 3');
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls(/page=3/).length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    await screen.findByText('Page 2 of 3');
  });
});
