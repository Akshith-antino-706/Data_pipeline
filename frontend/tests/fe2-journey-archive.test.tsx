// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import * as api from '@/lib/api';
import JourneyArchivePage from '@/app/(dashboard)/journeys/archive/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/journeys/archive',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ROWS = [
  { journey_id: 467, journey_name: '29th Sept - Emailer', journey_status: 'completed', journey_type: 'normal', completed_month: '2026-09',
    last_sent_at: '2026-09-29T12:51:21Z', archived_at: '2026-11-25T18:23:30Z', archive_bytes: 54_000_000, has_templates: true,
    entries: 1384772, sent: 718410, delivered: null, failed: 14, opened: 42194, human_opened: 41232, clicked: 38166, human_clicked: 37374,
    landed: 10, bounced: null, unsubscribed: 340, gtm_events: null, booked: 0, bot_window_sec: 15 },
  { journey_id: 242, journey_name: 'Weekly Broadcast', journey_status: 'completed', journey_type: 'normal', completed_month: '2026-07',
    last_sent_at: '2026-07-02T10:00:00Z', archived_at: '2026-11-20T18:00:00Z', archive_bytes: 330_000_000, has_templates: false,
    entries: 1333006, sent: 100, delivered: 80, opened: 40, clicked: 10, landed: 0, unsubscribed: 1 },
];
const TOTALS = { journeys: 2, entries: 2717778, sent: 718510, delivered: 80, opened: 42234, clicked: 38176, unsubscribed: 341, booked: 0, archive_bytes: 384_000_000 };
const mockTable = (rows: unknown[] = ROWS, total = rows.length) => vi.mocked(api.getArchiveTable).mockResolvedValue({
  data: { journeys: rows, total, totals: TOTALS, months: ['2026-09', '2026-07'], meta: { archived: 32, last_archived_at: new Date(Date.now() - 3 * 3600_000).toISOString() } },
});
const card = () => screen.getByRole('region', { name: 'Archived journeys' });
const lastOpts = () => vi.mocked(api.getArchiveTable).mock.lastCall?.[0];

describe('Journey Archive page', () => {
  it('shows At a glance totals and the Performance-style table, newest finished first', async () => {
    mockTable();
    render(<JourneyArchivePage />);
    await screen.findByText('29th Sept - Emailer');
    expect(screen.getByRole('heading', { level: 1, name: 'Journey Archive' })).toBeTruthy();
    expect(screen.getByTestId('archive-kpi-journeys').textContent).toContain('366 MB stored in S3');
    expect(screen.getByTestId('archive-kpi-sent').textContent).toContain('718,510');
    expect(card().textContent).toContain('32 in the archive · last archived 3 hours ago');
    expect(card().textContent).toContain('29 Sept 2026');      // completed day, Dubai time
    expect(card().textContent).toContain('Finished');
    expect(card().textContent).toContain('Showing 1–2 of 2');
    expect(lastOpts()).toEqual({ page: 1, limit: 20, sort: 'completed', dir: 'desc', fresh: undefined });
    for (const h of ['Journey', 'Status', 'Completed', 'Sent', 'Opened %', 'Clicked %', 'Unsubscribed']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeTruthy();
    }
    expect(card().textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('sends search, month, type, sort and page to the server', async () => {
    mockTable(ROWS, 45);
    render(<JourneyArchivePage />);
    await screen.findByText('29th Sept - Emailer');
    fireEvent.change(screen.getByLabelText('Month finished'), { target: { value: '2026-09' } });
    await waitFor(() => expect(lastOpts()).toMatchObject({ month: '2026-09', page: 1 }));
    fireEvent.change(screen.getByLabelText('Journey type'), { target: { value: 'fixed' } });
    await waitFor(() => expect(lastOpts()).toMatchObject({ type: 'fixed' }));
    fireEvent.click(screen.getByRole('button', { name: /^Sent/ }));
    await waitFor(() => expect(lastOpts()).toMatchObject({ sort: 'sent', dir: 'desc' }));
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await waitFor(() => expect(lastOpts()).toMatchObject({ page: 2 }));
    fireEvent.change(screen.getByLabelText('Search archived journeys'), { target: { value: 'visa' } });
    await waitFor(() => expect(lastOpts()).toMatchObject({ search: 'visa', page: 1 }), { timeout: 2000 });
  });

  it('opens a journey: steps from the archive, archived data downloads and the archived email preview', async () => {
    mockTable();
    vi.mocked(api.getArchiveNodes).mockResolvedValue({ data: [
      { node_id: 'node_1', node_label: 'KL Activities', template_id: 9, sent: 718410, delivered: null, opened: 42194, human_opened: 41232, clicked: 38166, landed: null, unsubscribed: 340 },
    ] });
    vi.mocked(api.getArchivedJourney).mockResolvedValue({ data: { manifest: { tables: { email_send_log: { rows: 718448, gz_bytes: 19525844 }, sms_send_log: { rows: 0, gz_bytes: 100 } } } } });
    vi.mocked(api.getArchivedNodeEmail).mockResolvedValue({ data: { node_id: 'node_1', emails: 718410, subjects: [{ subject: 'Things to do in KL', emails: 718410 }], template: null, stored_email: { subject: 'Things to do in KL', html: '<p>Hi</p>' } } });
    render(<JourneyArchivePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show steps for 29th Sept - Emailer' }));
    const steps = await screen.findByRole('table', { name: 'Steps of 29th Sept - Emailer' });
    expect(api.getArchiveNodes).toHaveBeenCalledWith(467, undefined);
    expect(within(steps).getByText('KL Activities')).toBeTruthy();
    expect(within(steps).getByText('41,232 real people')).toBeTruthy();
    expect(screen.getByRole('button', { name: /email_send_log/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /sms_send_log/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(steps).getByRole('button', { name: 'See the email for KL Activities' }));
    expect(await screen.findByTitle('Email preview')).toBeTruthy();
    expect(api.getArchivedNodeEmail).toHaveBeenCalledWith(467, 'node_1');
  });

  it('"Steps on" a day asks the archive for that day; no eye button when the email was not archived', async () => {
    mockTable();
    vi.mocked(api.getArchiveNodes).mockResolvedValue({ data: [{ node_id: 'node_1', node_label: 'Day 1', template_id: 5, sent: 100, opened: 40, clicked: 10 }] });
    render(<JourneyArchivePage />);
    await screen.findByText('Weekly Broadcast');
    fireEvent.change(screen.getByLabelText('Step breakdown day'), { target: { value: '2026-07-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show steps for Weekly Broadcast' }));
    const steps = await screen.findByRole('table', { name: 'Steps of Weekly Broadcast' });
    expect(api.getArchiveNodes).toHaveBeenCalledWith(242, '2026-07-02');
    expect(card().textContent).toContain('Steps that sent on');
    expect(within(steps).queryByRole('button', { name: /See the email/ })).toBeNull();   // has_templates false
  });

  it('downloads the CSV with the current filters and reloads fresh from S3', async () => {
    mockTable();
    render(<JourneyArchivePage />);
    await screen.findByText('29th Sept - Emailer');
    fireEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(api.downloadArchiveCsv).toHaveBeenCalledWith({ sort: 'completed', dir: 'desc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload from the archive' }));
    await waitFor(() => expect(lastOpts()).toMatchObject({ fresh: true }));
  });

  it('shows an error with a retry, and an empty message when nothing matches', async () => {
    vi.mocked(api.getArchiveTable).mockRejectedValueOnce(new Error('S3 unavailable'));
    render(<JourneyArchivePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('S3 unavailable');
    mockTable([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No journeys have been archived yet.')).toBeTruthy();
  });
});
