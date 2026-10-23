// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import * as api from '@/lib/api';
import LogPage from '@/app/(dashboard)/log/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
type SendLog = Awaited<ReturnType<typeof api.getSendLog>>;
const sendLog = (rows: Record<string, unknown>[], total: number) =>
  vi.mocked(api.getSendLog).mockResolvedValue({ data: { rows, total } } as unknown as SendLog);
const lastParams = () => vi.mocked(api.getSendLog).mock.calls.at(-1)?.[0];
const lastUnified = () => vi.mocked(api.getOverviewMessages).mock.calls.at(-1)?.[0];
type Unified = Awaited<ReturnType<typeof api.getOverviewMessages>>;
const unified = (rows: Record<string, unknown>[], total: number | null) =>
  vi.mocked(api.getOverviewMessages).mockResolvedValue({ page: 1, limit: 20, days: 30, channel: 'all', total, messages: { available: true, rows } } as unknown as Unified);
const MSGS = [
  { channel: 'whatsapp', id: 11, recipient: '+971500000001', contactName: 'Bob', label: 'promo_template', status: 'delivered', error: null, journeyId: 9, nodeId: 'w1', time: '2026-10-03T08:00:00Z', openedAt: null, clickedAt: null },
  { channel: 'sms', id: 12, recipient: '+971500000002', contactName: null, label: null, status: 'failed', error: 'Invalid number', journeyId: null, nodeId: null, time: null, openedAt: null, clickedAt: null },
];

const ROWS = [
  { id: 1, uc_name: 'Alice', email: 'alice@x.com', subject: 'Hello', template_label: 'Welcome', status: 'opened', journey_id: 7, node_id: 'n1', sent_at: '2026-10-01T08:00:00Z', opened_at: '2026-10-01T09:00:00Z', clicked_at: '2026-10-01T09:05:00Z', email_unsubscribed: 'Yes' },
  { id: 2, contact_name: null, email: null, status: 'bounced_weird', source: 'manual', created_at: '2026-10-02T08:00:00Z' },
];

describe('Send Log page', () => {
  it('shows 10,000+ and open-ended paging when the count is capped', async () => {
    vi.mocked(api.getSendLog).mockResolvedValue({ data: { rows: ROWS, total: 10000, capped: true } } as unknown as SendLog);
    render(<LogPage />);
    await screen.findByText('Alice');
    expect(screen.getByText('10,000+ records')).toBeTruthy();
    expect(screen.getByText('1–2 of 10,000+')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('updates the URL when the tab or status changes', async () => {
    unified(MSGS, 2);
    sendLog(ROWS, 2);
    window.history.replaceState(null, '', '/log?channel=all&status=failed');
    try {
      render(<LogPage />);
      await screen.findByText('Phone number is not valid');
      fireEvent.click(screen.getByRole('tab', { name: /Email/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Sent' }));
      await waitFor(() => expect(window.location.search).toBe('?status=sent'));
      fireEvent.click(screen.getByRole('button', { name: 'All Status' }));
      await waitFor(() => expect(window.location.search).toBe(''));
    } finally { window.history.replaceState(null, '', '/'); }
  });

  it('opens pre-filtered from a deep link (?channel=all&status=failed)', async () => {
    unified(MSGS, 2);
    window.history.replaceState(null, '', '/log?channel=all&status=failed');
    try {
      render(<LogPage />);
      await screen.findByText('Phone number is not valid');
      expect(lastUnified()).toMatchObject({ status: 'failed', page: 1 });
      expect(lastUnified()?.channel).toBeUndefined();
      expect(screen.getByRole('button', { name: 'Failed' }).getAttribute('aria-pressed')).toBe('true');
    } finally { window.history.replaceState(null, '', '/'); }
  });

  it('renders rows with typical data and requests page 1 / limit 20 for email', async () => {
    sendLog(ROWS, 2);
    render(<LogPage />);
    await screen.findByText('Alice');
    expect(screen.getByText('2 records')).toBeTruthy();
    expect(screen.getByText('alice@x.com')).toBeTruthy();
    expect(screen.getByText('Unsubscribed', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('manual')).toBeTruthy();
    expect(screen.getByText('bounced_weird')).toBeTruthy(); // unknown status falls back to raw label
    expect(screen.getByText('Not opened')).toBeTruthy();
    expect(screen.getByText('1–2 of 2')).toBeTruthy();
    expect(lastParams()).toEqual({ page: 1, limit: 20 });
    expect(api.getJourneys).toHaveBeenCalledWith({ limit: 200 });
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the empty state for an empty response', async () => {
    render(<LogPage />);
    await screen.findByText('No send logs found');
    expect(screen.getByText('0 records')).toBeTruthy();
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('falls back to empty when the API rejects', async () => {
    vi.mocked(api.getSendLog).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.getJourneys).mockRejectedValue(new Error('HTTP 500'));
    render(<LogPage />);
    await screen.findByText('No send logs found');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the loading state while the request is pending', () => {
    vi.mocked(api.getSendLog).mockReturnValue(new Promise<never>(() => {}));
    render(<LogPage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh/ }).hasAttribute('disabled')).toBe(true);
  });

  it('WhatsApp tab uses the unified endpoint with channel; SMS tab now calls it too', async () => {
    sendLog(ROWS, 2);
    render(<LogPage />);
    await screen.findByText('Alice');
    const sendCalls = vi.mocked(api.getSendLog).mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'WhatsApp' }));
    await waitFor(() => expect(lastUnified()).toEqual({ page: 1, limit: 20, channel: 'whatsapp' }));
    fireEvent.click(screen.getByRole('tab', { name: 'SMS' }));
    await waitFor(() => expect(lastUnified()).toEqual({ page: 1, limit: 20, channel: 'sms' }));
    expect(vi.mocked(api.getSendLog).mock.calls.length).toBe(sendCalls);
  });

  it('status, subscription and email search filters reach the API; Clear resets them', async () => {
    render(<LogPage />);
    await screen.findByText('No send logs found');
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'failed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribed' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ subscriptionStatus: 'unsubscribed' }));
    fireEvent.change(screen.getByPlaceholderText('Search by email…'), { target: { value: '  bob@x.com  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ email: 'bob@x.com' }));
    fireEvent.click(screen.getByRole('button', { name: /Clear \(3\)/ }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }));
  });

  it('paginates and changes page size', async () => {
    sendLog(ROWS, 45);
    render(<LogPage />);
    await screen.findByText('1 / 3');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 2, limit: 20 }));
    await screen.findByText('21–40 of 45');
    fireEvent.click(screen.getByRole('button', { name: '»' }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 3, limit: 20 }));
    expect(screen.getByRole('button', { name: /Next/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '50' }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 50 }));
    await screen.findByText('1 / 1');
  });

  it('journey select lists only action nodes and filters by journey and node', async () => {
    vi.mocked(api.getJourneys).mockResolvedValue({ data: { data: [
      { id: 5, name: 'Welcome Flow', nodes: [{ id: 'n1', type: 'action', data: { label: 'Send email' } }, { id: 'n2', type: 'trigger' }, { id: 'n3', type: 'action' }] },
    ] } } as unknown as Awaited<ReturnType<typeof api.getJourneys>>);
    render(<LogPage />);
    await screen.findByPlaceholderText('All journeys — type to search');
    const picker = screen.getByRole('combobox', { name: 'Journey' });
    fireEvent.change(picker, { target: { value: 'welc' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: '#5 Welcome Flow' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ journeyId: '5' }));
    expect((picker as HTMLInputElement).placeholder).toBe('#5 · Welcome Flow');
    // Node picker is searchable too: only action nodes, by label or id
    const nodePicker = screen.getByRole('combobox', { name: 'Node' });
    fireEvent.focus(nodePicker);
    expect(screen.getByRole('option', { name: 'n1 Send email' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'n3' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /n2/ })).toBeNull();
    fireEvent.change(nodePicker, { target: { value: 'send' } });
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['n1 Send email']);
    fireEvent.keyDown(nodePicker, { key: 'Enter' });
    await waitFor(() => expect(lastParams()).toMatchObject({ journeyId: '5', nodeId: 'n1' }));
    expect((nodePicker as HTMLInputElement).placeholder).toBe('n1 · Send email');
    fireEvent.click(screen.getByRole('button', { name: 'Clear node' }));
    await waitFor(() => expect(lastParams()).not.toHaveProperty('nodeId'));
  });

  it('journey picker searches by id or name, sorts newest first, supports keyboard and clear', async () => {
    vi.mocked(api.getJourneys).mockResolvedValue({ data: { data: [
      { id: 3, name: 'Old flow', nodes: [] }, { id: 512, name: 'whatsapp checkout journey', nodes: [] }, { id: 497, name: '12th October - BKK Activities', nodes: [] },
    ] } } as unknown as Awaited<ReturnType<typeof api.getJourneys>>);
    render(<LogPage />);
    const picker = await screen.findByRole('combobox', { name: 'Journey' });
    fireEvent.focus(picker);
    const names = () => screen.getAllByRole('option').map(o => o.textContent);
    expect(names()).toEqual(['All journeys', '#512 whatsapp checkout journey', '#497 12th October - BKK Activities', '#3 Old flow']);
    fireEvent.change(picker, { target: { value: '#49' } });
    expect(names()).toEqual(['#497 12th October - BKK Activities']);
    fireEvent.change(picker, { target: { value: 'zzz' } });
    expect(screen.getByText('No journey matches “zzz”')).toBeTruthy();
    fireEvent.change(picker, { target: { value: 'bkk' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    await waitFor(() => expect(lastParams()).toMatchObject({ journeyId: '497' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear journey' }));
    await waitFor(() => expect(lastParams()).not.toHaveProperty('journeyId'));
    fireEvent.keyDown(picker, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('All tab lists unified rows and passes status, search and journey filters', async () => {
    unified(MSGS, 2);
    render(<LogPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('Bob');
    expect(lastUnified()).toEqual({ page: 1, limit: 20 });
    expect(screen.getByText('Phone number is not valid')).toBeTruthy();
    expect(screen.getByText('1–2 of 2')).toBeTruthy();
    expect(screen.getByText('2 records')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Subscription' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(lastUnified()).toEqual({ page: 1, limit: 20, status: 'failed' }));
    fireEvent.change(screen.getByPlaceholderText('Search recipient or contact…'), { target: { value: ' bob ' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(lastUnified()).toMatchObject({ q: 'bob' }));
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('null total shows "Total unavailable" and pages by row count', async () => {
    unified(MSGS, null);
    render(<LogPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('Bob');
    expect(screen.getAllByText('Total unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('Page 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Next/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '»' })).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('unavailable section and rejected request show states, not fake data', async () => {
    vi.mocked(api.getOverviewMessages).mockResolvedValue({ page: 1, limit: 20, days: 30, channel: 'all', total: null, messages: { available: false, reason: 'unavailable' } } as Unified);
    render(<LogPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'SMS' }));
    await screen.findByText('Message log unavailable');
    expect(screen.getAllByText('Total unavailable').length).toBeGreaterThan(0);
    vi.mocked(api.getOverviewMessages).mockRejectedValue(new Error('HTTP 500'));
    fireEvent.click(screen.getByRole('tab', { name: 'WhatsApp' }));
    await screen.findByText("Couldn't load messages");
    expect(screen.getByText('HTTP 500')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('copies name, email and subject from a row without opening the drawer', async () => {
    sendLog(ROWS, 2);
    unified(MSGS, 2);
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<LogPage />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Copy alice@x.com' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('alice@x.com'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Alice' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Alice'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Hello' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hello'));
    // Rows without a value get no copy button
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('+971500000002');
    expect(screen.getByRole('button', { name: 'Copy +971500000002' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Bob' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy —' })).toBeNull();
  });

  it('opens a detail drawer with all fields for email and unified rows', async () => {
    sendLog(ROWS, 2);
    unified(MSGS, 2);
    render(<LogPage />);
    fireEvent.click(await screen.findByText('Alice'));
    const dlg = await screen.findByRole('dialog', { name: 'Message details' });
    expect(dlg.textContent).toContain('Welcome');
    expect(dlg.textContent).toContain('Unified contact ID');
    expect(dlg.textContent).toContain('n1');
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.click(await screen.findByText('+971500000002'));
    const d2 = await screen.findByRole('dialog', { name: 'Message details' });
    expect(d2.textContent).toContain('Invalid number');
    expect(d2.textContent).toContain('SMS');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });
});
