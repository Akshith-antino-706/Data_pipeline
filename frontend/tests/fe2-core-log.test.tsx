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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
type SendLog = Awaited<ReturnType<typeof api.getSendLog>>;
const sendLog = (rows: Record<string, unknown>[], total: number) =>
  vi.mocked(api.getSendLog).mockResolvedValue({ data: { rows, total } } as unknown as SendLog);
const lastParams = () => vi.mocked(api.getSendLog).mock.calls.at(-1)?.[0];

const ROWS = [
  { id: 1, uc_name: 'Alice', email: 'alice@x.com', subject: 'Hello', template_label: 'Welcome', status: 'opened', journey_id: 7, node_id: 'n1', sent_at: '2026-10-01T08:00:00Z', opened_at: '2026-10-01T09:00:00Z', clicked_at: '2026-10-01T09:05:00Z', email_unsubscribed: 'Yes' },
  { id: 2, contact_name: null, email: null, status: 'bounced_weird', source: 'manual', created_at: '2026-10-02T08:00:00Z' },
];

describe('Send Log page', () => {
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

  it('WhatsApp tab passes channel; SMS tab shows empty without calling the API', async () => {
    sendLog(ROWS, 2);
    render(<LogPage />);
    await screen.findByText('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, channel: 'whatsapp' }));
    const calls = vi.mocked(api.getSendLog).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    await screen.findByText('No send logs found');
    expect(vi.mocked(api.getSendLog).mock.calls.length).toBe(calls);
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
    await screen.findByText('#5 · Welcome Flow');
    fireEvent.change(screen.getByDisplayValue('All Journeys'), { target: { value: '5' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ journeyId: '5' }));
    expect(screen.getByRole('option', { name: 'Send email' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'n3' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'n2' })).toBeNull();
    fireEvent.change(screen.getByDisplayValue('All Nodes'), { target: { value: 'n1' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ journeyId: '5', nodeId: 'n1' }));
  });
});
