// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import * as api from '@/lib/api';
import UtmPage from '@/app/(dashboard)/utm/page';

vi.mock('@/lib/api');

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const bodyText = (): string => document.body.textContent ?? '';
const dubaiToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const daysBefore = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const visit = (i: number) => ({
  id: i, contact_name: `Person ${i}`, email: `p${i}@x.com`, utm_campaign: 'day1_welcome', utm_source: 'AI_marketer', utm_medium: 'email',
  destination_url: `https://www.raynatours.com/dubai/tour-${i}?utm_source=AI_marketer`, created_at: '2026-10-19T22:30:00Z',
});
const visitsPage = (from: number, count: number, total: number) => ({ data: { total, rows: Array.from({ length: count }, (_, k) => visit(from + k)) } });
const link = (i: number) => ({
  utm_id: i, channel: 'email', campaign_name: `Campaign ${i}`, campaign_status: 'running', segment_label: 'VIP', target_count: 1200,
  full_url: `https://www.raynatours.com/activities?utm_source=AI_marketer&utm_campaign=c${i}`, clicks: 1234,
});

let clipboardWrite: ReturnType<typeof vi.fn<(t: string) => Promise<void>>>;

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  window.history.replaceState(null, '', '/utm');
  clipboardWrite = vi.fn<(t: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Website & links — loading only what is open', () => {
  it('on open loads only the overview and the Email visits tab (last 7 Dubai days, 20 per page)', async () => {
    render(<UtmPage />);
    await waitFor(() => expect(api.getEmailUtmLog).toHaveBeenCalledTimes(1));
    const to = dubaiToday();
    expect(api.getEmailUtmLog).toHaveBeenCalledWith({
      page: 1, limit: 20, dateFrom: `${daysBefore(to, 6)}T00:00:00+04:00`, dateTo: `${to}T23:59:59.999+04:00`,
    });
    expect(api.getEmailUtmSummary).toHaveBeenCalledTimes(1);
    expect(api.getEmailUtmSummary).toHaveBeenCalledWith({
      page: 1, limit: 20, dateFrom: `${daysBefore(to, 6)}T00:00:00+04:00`, dateTo: `${to}T23:59:59.999+04:00`,
    });
    expect(api.getOverviewWebsite).toHaveBeenCalled();
    for (const fn of [api.getUTMAnalytics, api.getUserLinks, api.getUserLinkStats, api.getUTMSegments, api.getCampaigns]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('a tab loads the first time it is opened, once, and the tab is kept in ?tab=', async () => {
    vi.mocked(api.getUTMAnalytics).mockResolvedValue({ links: [link(1)], summary: [], total: 1 });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    await screen.findByText('Campaign 1');
    expect(window.location.search).toBe('?tab=campaigns');
    expect(api.getUTMAnalytics).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(api.getUTMSegments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Email visits' }));
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: 'Campaign links' }));
    expect(api.getUTMAnalytics).toHaveBeenCalledTimes(1);
    expect(api.getEmailUtmLog).toHaveBeenCalledTimes(1);
  });

  it('opens the tab named in ?tab= and does not load the default tab', async () => {
    window.history.replaceState(null, '', '/utm?tab=links');
    vi.mocked(api.getUserLinks).mockResolvedValue({ links: [{ link_id: 1, token: 'tok1', customer_name: 'Asha', click_count: 2 }], stats: { total_links: 1 } });
    render(<UtmPage />);
    await screen.findByText('Asha');
    expect(screen.getByRole('tab', { name: 'My links' }).getAttribute('aria-selected')).toBe('true');
    expect(api.getUserLinks).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(api.getEmailUtmLog).not.toHaveBeenCalled();
  });
});

describe('Website & links — skeletons, never an empty flash', () => {
  it('shows skeleton rows while a tab opens, with no empty message, then the rows', async () => {
    const d = deferred();
    vi.mocked(api.getUTMAnalytics).mockReturnValue(d.promise);
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    expect(await screen.findByTestId('campaign-links-loading')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Campaign links' }).getAttribute('aria-busy')).toBe('true');
    expect(bodyText()).not.toMatch(/No campaign links/);
    await act(async () => { d.resolve({ links: [link(7)], summary: [{ channel: 'email', total_links: 1, total_clicks: 1234 }], total: 1 }); });
    expect(await screen.findByText('Campaign 7')).toBeTruthy();
    expect(screen.queryByTestId('campaign-links-loading')).toBeNull();
    expect(screen.getAllByText('1,234').length).toBeGreaterThan(0);
  });

  it('page change keeps the table and shows skeleton rows until the next page arrives', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValueOnce(visitsPage(1, 20, 45));
    render(<UtmPage />);
    await screen.findByText('Person 1');
    const card = screen.getByRole('region', { name: 'Visits from emails' });
    expect(within(card).getByText('Showing 1–20 of 45')).toBeTruthy();
    const next = deferred();
    vi.mocked(api.getEmailUtmLog).mockReturnValueOnce(next.promise);
    fireEvent.click(within(card).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.getEmailUtmLog).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 20 })));
    expect(screen.getByTestId('visits-loading')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Email visits' })).toBeTruthy();
    expect(screen.queryByText('Person 1')).toBeNull();
    expect(bodyText()).not.toMatch(/No email visits|No visits match/);
    await act(async () => { next.resolve(visitsPage(21, 20, 45)); });
    await screen.findByText('Person 21');
    expect(within(card).getByText('Showing 21–40 of 45')).toBeTruthy();
  });

  it('page size 50 asks the server for 50 from page 1', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValue(visitsPage(1, 20, 45));
    render(<UtmPage />);
    await screen.findByText('Person 1');
    const card = screen.getByRole('region', { name: 'Visits from emails' });
    fireEvent.change(within(card).getByLabelText('Rows per page'), { target: { value: '50' } });
    await waitFor(() => expect(api.getEmailUtmLog).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 50 })));
  });

  it('hides the pager when everything fits on one page', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValue(visitsPage(1, 3, 3));
    render(<UtmPage />);
    await screen.findByText('Person 3');
    expect(screen.queryByLabelText('Rows per page')).toBeNull();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('shows "Still working on it" after 8 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getEmailUtmLog).mockReturnValue(new Promise(() => {}));
    render(<UtmPage />);
    await act(async () => { vi.advanceTimersByTime(8100); });
    expect(screen.getAllByText(/Still working on it/).length).toBeGreaterThan(0);
  });
});

describe('Website & links — errors, retries and stale answers', () => {
  it('shows one compact error line, and Try again clears it and shows the skeleton', async () => {
    vi.mocked(api.getEmailUtmLog).mockRejectedValueOnce(new Error('HTTP 500'));
    render(<UtmPage />);
    const err = await screen.findByText(/Couldn't load email visits/);
    const again = deferred();
    vi.mocked(api.getEmailUtmLog).mockReturnValueOnce(again.promise);
    fireEvent.click(within(err.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('visits-loading');
    expect(screen.queryByText(/Couldn't load email visits/)).toBeNull();
    await act(async () => { again.resolve(visitsPage(1, 1, 1)); });
    await screen.findByText('Person 1');
  });

  it('retries a dropped connection once, quietly', async () => {
    vi.mocked(api.getEmailUtmLog).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(visitsPage(1, 1, 1));
    render(<UtmPage />);
    await screen.findByText('Person 1', undefined, { timeout: 4000 });
    expect(api.getEmailUtmLog).toHaveBeenCalledTimes(2);
    expect(bodyText()).not.toMatch(/Couldn't load email visits/);
  });

  it('ignores a slow answer for an older search', async () => {
    const first = deferred();
    vi.mocked(api.getUTMAnalytics).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ links: [{ ...link(2), campaign_name: 'Fresh result' }], summary: [], total: 1 });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    fireEvent.change(screen.getByLabelText('Search campaign links'), { target: { value: 'fresh' } });
    await screen.findByText('Fresh result');
    expect(api.getUTMAnalytics).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'fresh' });
    await act(async () => { first.resolve({ links: [{ ...link(1), campaign_name: 'Stale result' }], summary: [], total: 1 }); });
    expect(screen.queryByText('Stale result')).toBeNull();
    expect(screen.getByText('Fresh result')).toBeTruthy();
  });
});

describe('Website & links — content', () => {
  it('nothing in the last 7 days → one compact line, no table, and it can widen to all dates', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValue({ data: { total: 0, rows: [] } });
    render(<UtmPage />);
    const note = await screen.findByTestId('visits-none');
    expect(note.textContent).toMatch(/No email visits in the last 7 days \(\d+ \w{3} – \d+ \w{3}\)/);
    expect(screen.queryByRole('table', { name: 'Email visits' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Visits by campaign' })).toBeNull();
    fireEvent.click(within(note).getByRole('button', { name: 'Show all dates' }));
    await waitFor(() => expect(api.getEmailUtmLog).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    expect((await screen.findByTestId('visits-none')).textContent).toBe('No email visits yet.');
  });

  it('visits show human Dubai dates, thousands separators, path with full-URL tooltip and copy', async () => {
    vi.mocked(api.getEmailUtmLog).mockResolvedValue({ data: { total: 12345, rows: [visit(1)] } });
    render(<UtmPage />);
    await screen.findByText('Person 1');
    expect(screen.getByText(/12,345 visits/)).toBeTruthy();
    expect(screen.getByText(/^20 Oct.*2:30 am$/i)).toBeTruthy();
    const path = screen.getByText('/dubai/tour-1');
    expect(path.getAttribute('title')).toBe(visit(1).destination_url);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link /dubai/tour-1' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(visit(1).destination_url));
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();
  });

  it('campaign links: plain columns, no always-zero bookings/revenue, generate-all only after confirm', async () => {
    vi.mocked(api.getUTMAnalytics).mockResolvedValue({ links: [link(1)], summary: [], total: 1 });
    vi.mocked(api.generateAllUTM).mockResolvedValue({ total_links: 1500, segments_processed: 12 });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    const table = await screen.findByRole('table', { name: 'Campaign links' });
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toEqual(['Campaign', 'Channel', 'Audience', 'Link', 'Clicks']);
    expect(within(table).getByText('Running')).toBeTruthy();
    expect(within(table).getByText('1,200 people')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More campaign link actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Create links for all campaigns/ }));
    expect(api.generateAllUTM).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create links' }));
    await screen.findByText('Created 1,500 campaign links across 12 audiences.');
    expect(api.generateAllUTM).toHaveBeenCalledTimes(1);
  });

  it('no campaign links → one line with the create action', async () => {
    vi.mocked(api.getUTMAnalytics).mockResolvedValue({ links: [], summary: [], total: 0 });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    const note = await screen.findByTestId('campaign-links-none');
    expect(within(note).getByRole('button', { name: /Create links for all campaigns/ })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Campaign links' })).toBeNull();
  });

  it('older API without a total still pages 20 at a time on the client', async () => {
    vi.mocked(api.getUTMAnalytics).mockResolvedValue({ links: Array.from({ length: 30 }, (_, i) => link(i + 1)), summary: [] });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Campaign links' }));
    await screen.findByText('Campaign 1');
    expect(screen.queryByText('Campaign 21')).toBeNull();
    expect(screen.getByText('Showing 1–20 of 30')).toBeTruthy();
  });

  it('my links: server paging with filters, and no duplicate totals', async () => {
    vi.mocked(api.getUserLinkStats).mockResolvedValue({ campaigns: [{ campaign_id: 5, campaign_name: 'Spring' }], totals: { total_links: '45' } });
    vi.mocked(api.getUserLinks).mockResolvedValue({ links: [{ link_id: 1, token: 'abc', customer_name: 'Asha', customer_email: 'a@x.com', click_count: 0 }], stats: { total_links: '45' } });
    vi.mocked(api.getCampaigns).mockResolvedValue({ data: [{ id: 5, name: 'Spring', segment_label: 'VIP', channel: 'email' }] });
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'My links' }));
    await screen.findByText('Asha');
    // the campaign picker is searched on the server, 50 at a time
    await waitFor(() => expect(api.getCampaigns).toHaveBeenLastCalledWith({ limit: 50 }));
    fireEvent.change(screen.getByLabelText('Find a campaign'), { target: { value: 'spr' } });
    await waitFor(() => expect(api.getCampaigns).toHaveBeenLastCalledWith({ search: 'spr', limit: 50 }));
    expect(screen.getByRole('option', { name: 'Spring — VIP (Email)' })).toBeTruthy();
    expect(screen.getByText('Showing 1–1 of 45')).toBeTruthy();
    expect(screen.queryByText('Personal links by campaign')).toBeNull();
    fireEvent.change(screen.getByLabelText('Clicked or not'), { target: { value: 'true' } });
    await waitFor(() => expect(api.getUserLinks).toHaveBeenLastCalledWith({ page: 1, limit: 20, clicked: 'true' }));
    fireEvent.change(screen.getByLabelText('Campaign'), { target: { value: '5' } });
    await waitFor(() => expect(api.getUserLinks).toHaveBeenLastCalledWith({ page: 1, limit: 20, campaignId: '5', clicked: 'true' }));
  });
});

describe('Website & links — link builder', () => {
  it('header button opens the builder drawer; live preview; Create calls the API; Escape closes', async () => {
    vi.mocked(api.getUTMSegments).mockResolvedValue({ data: [{ segment_name: 'VIP', customer_count: 1200 }] });
    vi.mocked(api.buildUTM).mockResolvedValue({ utm_url: 'https://www.raynatours.com/activities?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=Spring_Sale_VIP&utm_content=whatsapp_1' });
    render(<UtmPage />);
    fireEvent.click(screen.getByRole('button', { name: /Create a tracked link/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Create a tracked link' });
    expect(api.getUTMSegments).toHaveBeenCalledTimes(1);
    const option = await within(dialog).findByRole('option', { name: 'VIP (1,200 people)' });
    fireEvent.change(option.closest('select') as HTMLSelectElement, { target: { value: 'VIP' } });
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Spring_Sale_Email'), { target: { value: 'Spring Sale' } });
    fireEvent.change(within(dialog).getByDisplayValue('Email'), { target: { value: 'whatsapp' } });
    const preview = within(dialog).getByTestId('link-preview');
    expect(preview.textContent).toContain('utm_campaign=Spring_Sale_VIP');
    expect(preview.textContent).toContain('utm_medium=whatsapp');
    expect(within(dialog).getByText('utm_source')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Create link/ }));
    await within(dialog).findByText('Your link is ready');
    expect(api.buildUTM).toHaveBeenCalledWith({ baseUrl: 'https://www.raynatours.com/activities', channel: 'whatsapp', campaignName: 'Spring Sale', segmentLabel: 'VIP', contentNumber: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('utm_campaign=Spring_Sale_VIP')));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Create stays disabled until a campaign name and audience are set', async () => {
    vi.mocked(api.getUTMSegments).mockResolvedValue([{ segment_name: 'VIP' }]);
    render(<UtmPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Link builder' }));
    const panel = screen.getByRole('tabpanel', { name: 'Link builder' });
    expect((within(panel).getByRole('button', { name: /Create link/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText(/Enter a campaign name and choose an audience/)).toBeTruthy();
  });
});
