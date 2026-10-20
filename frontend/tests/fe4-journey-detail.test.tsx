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
  pathname: '/journeys/5',
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

// The Recharts charts load through next/dynamic; replace them with plain lists so the
// funnel stages / step bars (and the step chart's click-to-select) can be asserted.
interface ChartRow { name: string; value?: number; pct?: number | null; now?: number; done?: number | null }
vi.mock('next/dynamic', () => ({
  default: () => function ChartStub({ data, onSelect }: { data: ChartRow[]; onSelect?: (i: number) => void }) {
    const isFunnel = data.length > 0 && 'pct' in data[0];
    return (
      <ul data-testid={isFunnel ? 'funnel-chart' : 'step-chart'}>
        {data.map((d, i) => (
          <li key={d.name}>
            {onSelect
              ? <button type="button" onClick={() => onSelect(i)}>{`bar ${d.name}=${d.now}`}</button>
              : `${d.name}=${d.value}${d.pct === null || d.pct === undefined ? '' : ` (${d.pct}%)`}`}
          </li>
        ))}
      </ul>
    );
  },
}));

class RO { observe(): void {} unobserve(): void {} disconnect(): void {} }

const DAY = 86_400_000;
const DETAIL = {
  journey_id: 5, name: 'Welcome Series', status: 'active', journey_type: 'fixed', segment_name: 'New sign-ups',
  conversion_rate: '0', snapshot_count: 1240, created_at: new Date(Date.now() - 3 * DAY).toISOString(),
  entryStats: { total_entries: '1240', active: '812', completed: '390', exited_booked: '38', exited_unsubscribed: '21', pre_existing_unsub: 0 },
  nodes: [
    { id: 'n0', type: 'trigger', data: { label: 'Start' } },
    { id: 'n1', type: 'action', data: { label: 'Welcome email', channel: 'email', emailTemplateId: 11 } },
    { id: 'n2', type: 'wait', data: { label: 'Wait a bit', waitDays: 2, waitUnit: 'days' } },
    { id: 'n3', type: 'action', data: { label: 'WA nudge', channel: 'whatsapp' } },
  ],
  edges: [],
  nodeAnalytics: [
    { node_id: 'n1', event_type: 'action_sent', event_count: '1200' },
    { node_id: 'n3', event_type: 'action_blocked', event_count: '4' },
  ],
  node_stats: { n1: { active: 7, completed: 3, exited_booked: 0, exited: 0 }, n3: { active: 2, completed: 0, exited_booked: 0, exited: 0 } },
  node_statuses: { n1: 'completed' },
};
const CAMPAIGN = { campaigns: [], totals: { total_failed: 3 }, opens: { n1: 480 }, gtm_clicks: { n1: 96 } };

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.replace.mockReset();
  nav.search = new URLSearchParams();
  nav.pathname = '/journeys/5';
  window.history.replaceState(null, '', '/journeys/5');
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  localStorage.setItem('business-type', 'All');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled'))));
  vi.stubGlobal('ResizeObserver', RO);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(api.getJourneys).mockResolvedValue({ data: [DETAIL] });
  vi.mocked(api.getJourney).mockResolvedValue({ data: DETAIL });
  vi.mocked(api.getTemplates).mockResolvedValue({ data: [{ id: 11, name: 'Welcome tpl', subject: 'Hi there', channel: 'email' }] });
  vi.mocked(api.getJourneyQueueCounts).mockResolvedValue({ data: { email: { waiting: 5, active: 1, delayed: 9, failed: 2 } } });
  vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({ data: CAMPAIGN });
  vi.mocked(api.getJourneyEntries).mockResolvedValue({
    data: [{
      entry_id: 1, name: 'Asha', email: 'asha@x.com', status: 'active', current_node_id: 'n1',
      entered_at: new Date(Date.now() - 2 * DAY).toISOString(), next_fire_at: new Date(Date.now() + DAY).toISOString(),
    }],
    total: 1,
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><Journeys /></BusinessTypeProvider>);
const openDetail = async () => { renderPage(); await screen.findByRole('heading', { name: 'Welcome Series' }); };
const stepsList = () => screen.getByRole('list', { name: 'Journey steps' });
const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /^Advanced/ }));

describe('Journey detail', () => {
  it('/journeys/5 loads journey 5; "All journeys" goes back to /journeys and shows the list', async () => {
    await openDetail();
    expect(api.getJourney).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: /All journeys/ }));
    expect(window.location.pathname).toBe('/journeys');
    await waitFor(() => expect(screen.queryByRole('button', { name: /All journeys/ })).toBeNull());
  });

  it('shows a loading skeleton with plain labels while the journey loads', async () => {
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Loading journey')).toBeTruthy());
    expect(bodyText()).toContain('People joined');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('opens with a plain-language summary sentence and status explanation', async () => {
    await openDetail();
    const summary = screen.getByRole('region', { name: 'Journey summary' });
    const text = summary.textContent ?? '';
    expect(text).toMatch(/Running · Sends email and WhatsApp to people in 'New sign-ups' \(1,240 joined\) · Created \w{3}, \d{1,2} \w{3}/);
    expect(text).toContain('This journey is running. Everyone in the segment joined when it started');
    expect(within(summary).getByText('How people join')).toBeTruthy();
    expect(within(summary).getByText('Once — everyone in the segment when the journey starts')).toBeTruthy();
    expect(within(summary).getByText('Email + WhatsApp')).toBeTruthy();
  });

  it('explains paused and always-on journeys in plain words', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, status: 'paused' } });
    await openDetail();
    expect(bodyText()).toContain('Paused — nobody receives messages until you resume it.');
    cleanup();
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, journey_type: 'continuous' } });
    await openDetail();
    expect(bodyText()).toContain('New people who match the segment join automatically.');
  });

  it('"How is it doing?" numbers come from entryStats, with % of joined', async () => {
    await openDetail();
    const kpis = screen.getByRole('list', { name: 'Journey totals' });
    for (const v of ['1,240', '812', '390', '21', '38']) expect(within(kpis).getByText(v)).toBeTruthy();
    for (const l of ['People joined', 'Still in progress', 'Finished', 'Unsubscribed', 'Booked', 'Messages that failed']) {
      expect(within(kpis).getByText(l)).toBeTruthy();
    }
    expect(within(kpis).getByText('31% of joined')).toBeTruthy();
    expect(await within(kpis).findByText('3')).toBeTruthy(); // failed, from the delivery report
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('numbers show "—" (not 0 or NaN) when the data is missing', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, entryStats: undefined, snapshot_count: null } });
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    await openDetail();
    const kpis = screen.getByRole('list', { name: 'Journey totals' });
    expect(within(kpis).getAllByText('—').length).toBe(6);
    expect(within(kpis).queryByText(/% of joined/)).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('funnel stages and values come from the loaded data', async () => {
    await openDetail();
    const funnel = await screen.findByTestId('funnel-chart');
    await waitFor(() => expect(within(funnel).getByText('Opened=480 (39%)')).toBeTruthy());
    expect(Array.from(funnel.querySelectorAll('li')).map(li => li.textContent)).toEqual([
      'People joined=1240 (100%)', 'Got a message=1200 (97%)', 'Opened=480 (39%)', 'Clicked=96 (8%)', 'Booked=38 (3%)',
    ]);
    const img = screen.getByRole('img', { name: /Where people drop off/ });
    expect(img.getAttribute('aria-label')).toContain('Got a message 1,200 (97%)');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('funnel skips stages whose data is not available', async () => {
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, nodeAnalytics: [], entryStats: { ...DETAIL.entryStats, exited_booked: undefined } } });
    await openDetail();
    await waitFor(() => expect(api.getJourneyCampaignAnalytics).toHaveBeenCalledWith(5));
    const funnel = await screen.findByTestId('funnel-chart');
    expect(Array.from(funnel.querySelectorAll('li')).map(li => li.textContent)).toEqual(['People joined=1240 (100%)']);
  });

  it('shows "No data yet" instead of empty charts', async () => {
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, entryStats: undefined, snapshot_count: null, nodeAnalytics: [], node_stats: undefined } });
    await openDetail();
    expect(screen.queryByTestId('funnel-chart')).toBeNull();
    expect(screen.queryByTestId('step-chart')).toBeNull();
    expect(screen.getAllByText('No data yet').length).toBe(2);
  });

  it('describes each step in a plain numbered sentence, with waits as connectors', async () => {
    await openDetail();
    const steps = stepsList();
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3); // the entry trigger is not a step
    await waitFor(() => expect(items[0].textContent).toContain("Send email 'Welcome tpl'"));
    expect(items[0].textContent).toContain('Day 1');
    expect(items[0].textContent).toContain('(sent 1,200 · opened 40%)');
    expect(items[0].textContent).toContain('7 on this step now');
    expect(items[0].textContent).toContain('3 done');
    expect(within(items[0]).getByText('Done')).toBeTruthy(); // node status "completed" in plain words
    expect(items[1].textContent).toContain('Wait 2 days');
    expect(items[2].textContent).toContain("Send WhatsApp 'WA nudge'");
    expect(items[2].textContent).toContain('Day 3');
    expect(within(steps).getByRole('button', { name: /^Step 1: Send email/ })).toBeTruthy();
    expect(bodyText()).toContain('People join: once — everyone in the segment when the journey starts.');
  });

  it('"People at each step" chart has one bar per step and clicking a bar opens that step', async () => {
    await openDetail();
    const chart = screen.getByTestId('step-chart');
    const bars = within(chart).getAllByRole('button');
    expect(bars).toHaveLength(3);
    expect(bars[1].textContent).toBe('bar 2 · Wait 2 days=0');
    expect(bars[2].textContent).toBe('bar 3 · WhatsApp: WA nudge=2');
    expect(screen.queryByLabelText('Step details')).toBeNull();
    fireEvent.click(bars[2]);
    const panel = screen.getByLabelText('Step details');
    expect(within(panel).getByText('Step 3 · WA nudge')).toBeTruthy();
    expect(screen.getByRole('img', { name: /People at each step: 1 · Email/ })).toBeTruthy();
  });

  it('Pause calls pauseJourney', async () => {
    vi.mocked(api.pauseJourney).mockResolvedValue({ data: { status: 'paused' } });
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /^Pause$/ }));
    await waitFor(() => expect(api.pauseJourney).toHaveBeenCalledWith(5));
  });

  it('Resume shows for a paused journey and calls pauseJourney', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, status: 'paused' } });
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await waitFor(() => expect(api.pauseJourney).toHaveBeenCalledWith(5));
  });

  it('Start journey on a draft asks to confirm and calls startJourney', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, status: 'draft' } });
    vi.mocked(api.startJourney).mockResolvedValue({ data: { status: 'active' } });
    await openDetail();
    expect(bodyText()).toContain('Draft — nobody receives messages until you start it.');
    fireEvent.click(screen.getByRole('button', { name: /Start journey/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.startJourney).toHaveBeenCalledWith(5));
  });

  it('Edit opens the rename form and Save calls updateJourney', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Journey name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateJourney).toHaveBeenCalled());
    expect(vi.mocked(api.updateJourney).mock.calls[0][0]).toBe(5);
  });

  it('clicking a step opens its details and previews the template', async () => {
    vi.mocked(api.previewJourneyNodeEmail).mockResolvedValue({ data: { html: '<p>x</p>' } });
    await openDetail();
    expect(screen.queryByLabelText('Step details')).toBeNull();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const panel = screen.getByLabelText('Step details');
    await within(panel).findByText('Welcome tpl');
    expect(within(panel).getByText('Subject: Hi there')).toBeTruthy();
    expect(within(panel).getByText('Last ran')).toBeTruthy();
    expect(within(panel).getByText('Not yet')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(api.previewJourneyNodeEmail).toHaveBeenCalledWith(5, 'n1'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Close step details' }));
    expect(screen.queryByLabelText('Step details')).toBeNull();
  });

  it('step details show last/next run as human Dubai dates', async () => {
    const next = new Date(Date.now() + DAY).toISOString();
    vi.mocked(api.getJourneyTimeline).mockResolvedValue({ data: { journeyId: 5, timeline: [{ nodeId: 'n1', triggeredAt: '2025-01-05T06:00:00Z', nextFireAt: next }] } });
    await openDetail();
    await waitFor(() => expect(api.getJourneyTimeline).toHaveBeenCalledWith(5));
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const panel = screen.getByLabelText('Step details');
    await waitFor(() => expect(panel.textContent).toContain('Sun, 5 Jan 2025, 10:00 AM'));
    expect(panel.textContent).toMatch(/Tomorrow \d{1,2}:\d{2} (AM|PM)/);
    expect(panel.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('selecting a step with skipped people offers Retry skipped', async () => {
    vi.mocked(api.retryBlockedEntries).mockResolvedValue({ data: { retried: 4 } });
    await openDetail();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 3:/ }));
    const panel = screen.getByLabelText('Step details');
    expect(within(panel).getByText('No template set for this step')).toBeTruthy();
    expect(panel.textContent).toContain('4 people were skipped');
    fireEvent.click(within(panel).getByRole('button', { name: /Retry skipped/ }));
    await waitFor(() => expect(api.retryBlockedEntries).toHaveBeenCalledWith(5, 'n3'));
  });

  it('step technical details (ids) are tucked away in a collapsed section', async () => {
    await openDetail();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const panel = screen.getByLabelText('Step details');
    const tech = within(panel).getByText('Technical details').closest('details');
    expect(tech).toBeTruthy();
    expect(tech?.open).toBe(false);
    expect(within(tech as HTMLElement).getByText('n1')).toBeTruthy();
  });

  it('"Who is in this journey" shows people with plain columns and human dates', async () => {
    await openDetail();
    const table = await screen.findByRole('region', { name: 'People in this journey' });
    expect(await within(table).findByText('Asha')).toBeTruthy();
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toEqual(['Contact', 'Current step', 'Status', 'Joined on', 'Next message']);
    expect(within(table).getByText('Step 1 · Welcome email')).toBeTruthy();
    expect(within(table).getByText('In progress')).toBeTruthy();
    expect(table.textContent).toMatch(/Tomorrow \d{1,2}:\d{2} (AM|PM)/);
    expect(table.textContent).toMatch(/\w{3}, \d{1,2} \w{3}/);
    expect(bodyText()).not.toMatch(/\d{4}-\d{2}-\d{2}T|NaN|undefined/);
  });

  it('the people status filter reloads the list for that status', async () => {
    await openDetail();
    await screen.findByText('Asha');
    vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [], total: 0 });
    fireEvent.change(screen.getByLabelText('Filter people by status'), { target: { value: 'completed' } });
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 1, limit: 50, status: 'completed' }));
    expect(await screen.findByText('Nobody matches this filter')).toBeTruthy();
  });

  it('a failed people load shows a plain error with Try again', async () => {
    vi.mocked(api.getJourneyEntries).mockRejectedValue(new Error('boom'));
    await openDetail();
    expect(await screen.findByText("We couldn't load the people in this journey")).toBeTruthy();
    vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [{ entry_id: 2, name: 'Ravi', status: 'completed', current_node_id: 'n3' }], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Ravi')).toBeTruthy();
  });

  it('the main view uses no jargon (node, trigger, snapshot, fire time, entries)', async () => {
    await openDetail();
    await screen.findByText('Asha');
    expect(bodyText()).not.toMatch(/\bnodes?\b|trigger|snapshot|fire time|next fire|\bentr(y|ies)\b/i);
    expect(bodyText()).toContain('What happens, step by step');
    expect(bodyText()).toContain('How is it doing?');
    expect(bodyText()).toContain('Who is in this journey');
  });

  it('Advanced is collapsed by default but opens to the queue, technical details and the old tools', async () => {
    await openDetail();
    const toggle = screen.getByRole('button', { name: /^Advanced/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tablist', { name: 'Advanced tools' })).toBeNull();
    expect(bodyText()).not.toContain('9 scheduled');
    openAdvanced();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const tabs = screen.getByRole('tablist', { name: 'Advanced tools' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent?.trim())).toEqual(['Flow builder', 'People', 'Analytics', 'Activity', 'Settings']);
    expect(bodyText()).toContain('9 scheduled');
    expect(bodyText()).toContain('2 failed');
    expect(screen.getAllByText('Technical details').length).toBeGreaterThan(0);
    expect(bodyText()).toContain('Journey ID5');
    fireEvent.click(within(tabs).getByRole('tab', { name: /Settings/ }));
    expect(screen.getByText('Journey Configuration')).toBeTruthy();
    openAdvanced();
    expect(screen.queryByRole('tablist', { name: 'Advanced tools' })).toBeNull();
  });

  it('More menu holds the less common actions and opens the Advanced tools', async () => {
    vi.mocked(api.aiFlowSuggest).mockResolvedValue({ data: { overall_score: 80, suggestions: [] } });
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const menu = screen.getByRole('menu');
    for (const l of ['Edit steps', 'AI flow assist', 'Full people list', 'Analytics', 'Activity', 'Settings', 'Copy journey ID', 'Delete journey']) {
      expect(within(menu).getByText(l)).toBeTruthy();
    }
    fireEvent.click(within(menu).getByText('AI flow assist'));
    await waitFor(() => expect(api.aiFlowSuggest).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^Advanced/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByRole('tablist', { name: 'Advanced tools' })).getByRole('tab', { name: /Flow builder/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Analytics'));
    expect(within(screen.getByRole('tablist', { name: 'Advanced tools' })).getByRole('tab', { name: /Analytics/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete journey'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Forever' }));
    await waitFor(() => expect(api.deleteJourney).toHaveBeenCalledWith(5));
  });

  it('a failed detail load returns to the list with an error toast', async () => {
    vi.mocked(api.getJourney).mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(bodyText()).toContain('Failed to load journey'));
    expect(window.location.pathname).toBe('/journeys');
  });

  it('handles the real timeline API shape ({ journeyId, timeline: [...] }) without crashing', async () => {
    vi.mocked(api.getJourneyTimeline).mockResolvedValue({ data: { journeyId: 5, journeyStatus: 'active', scheduledStartAt: null, timeline: [{ nodeId: 'node_1', status: 'completed' }] } });
    await openDetail();
    await waitFor(() => expect(api.getJourneyTimeline).toHaveBeenCalledWith(5));
    expect(screen.getByRole('heading', { name: 'Welcome Series' })).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('ignores a malformed timeline payload', async () => {
    vi.mocked(api.getJourneyTimeline).mockResolvedValue({ data: { unexpected: true } });
    await openDetail();
    expect(screen.getByRole('heading', { name: 'Welcome Series' })).toBeTruthy();
  });
});
