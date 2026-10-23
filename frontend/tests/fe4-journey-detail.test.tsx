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

// The Recharts step chart loads through next/dynamic; replace it with a plain list so the
// step bars (and the chart's click-to-select) can be asserted.
interface ChartRow { name: string; now: number; done: number | null }
vi.mock('next/dynamic', () => ({
  default: () => function ChartStub({ data, onSelect }: { data: ChartRow[]; onSelect: (i: number) => void }) {
    return (
      <ul data-testid="step-chart">
        {data.map((d, i) => (
          <li key={d.name}><button type="button" onClick={() => onSelect(i)}>{`bar ${d.name}=${d.now}`}</button></li>
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
// Flow is the default tab; most checks below are about the Overview tab, so open it.
const openDetail = async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Welcome Series' });
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Journey sections' })).getByRole('tab', { name: /Overview/ }));
};
const sections = () => screen.getByRole('tablist', { name: 'Journey sections' });
const sectionTab = (name: RegExp) => within(sections()).getByRole('tab', { name });
const openSection = (name: RegExp) => fireEvent.click(sectionTab(name));
const stepsList = () => screen.getByRole('list', { name: 'Journey steps' });
const ISO = /\d{4}-\d{2}-\d{2}T/;

describe('Journey detail', () => {
  it('loads people only when the People tab is opened', async () => {
    await openDetail();
    expect(api.getJourneyEntries).not.toHaveBeenCalledWith(5, expect.objectContaining({ page: 1 }));
    openSection(/People/);
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenCalledWith(5, expect.objectContaining({ page: 1 })));
  });

  it('/journeys/5 loads journey 5; "All journeys" goes back to /journeys and shows the list', async () => {
    await openDetail();
    expect(api.getJourney).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: /All journeys/ }));
    expect(window.location.pathname).toBe('/journeys');
    await waitFor(() => expect(screen.queryByRole('button', { name: /All journeys/ })).toBeNull());
  });

  it('shows a compact loading skeleton with plain labels while the journey loads', async () => {
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Loading journey')).toBeTruthy());
    // Mirrors the real layout: section tabs and the flow canvas, not an unrelated KPI grid.
    for (const t of ['Flow', 'Overview', 'People', 'Advanced']) expect(bodyText()).toContain(t);
    expect(bodyText()).toContain('Loading the journey…');
    expect(bodyText()).not.toContain('People joined');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('header is one line: name, status chip and a short summary; the longer explanation is a tooltip', async () => {
    await openDetail();
    const summary = screen.getByRole('region', { name: 'Journey summary' });
    expect(within(summary).getByText('Running')).toBeTruthy();
    expect(screen.getByTestId('journey-summary-line').textContent).toBe('Email + WhatsApp · New sign-ups · 1,240 joined');
    const info = within(summary).getByRole('button', { name: 'About this journey' });
    const tip = document.getElementById(info.getAttribute('aria-describedby') ?? '');
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.textContent).toContain('This journey is running. Everyone in the segment joined when it started');
    expect(tip?.textContent).toContain('How people join: Once — everyone in the segment when the journey starts');
    expect(tip?.textContent).toMatch(/Created: \w{3}, \d{1,2} \w{3}/);
    // No paragraph of explanation on the page itself.
    expect(within(summary).queryByRole('paragraph')).toBeNull();
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

  it('has Flow · Overview · People · Advanced tabs, with Flow selected by default', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Welcome Series' });
    await waitFor(() => expect(within(sections()).getAllByRole('tab').map(t => t.textContent)).toEqual(['Flow', 'Overview', 'People', 'Advanced']));
    expect(sectionTab(/Flow/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Flow' })).toBeTruthy();
  });

  it('Overview shows 4 KPI tiles from entryStats, with % of joined, and unsubscribed / failed on a thin line', async () => {
    await openDetail();
    const kpis = screen.getByRole('list', { name: 'Journey totals' });
    const tiles = within(kpis).getAllByRole('listitem');
    expect(tiles).toHaveLength(4);
    expect(tiles.map(t => t.querySelector('span')?.textContent)).toEqual(['People joined', 'In progress', 'Finished', 'Booked']);
    for (const v of ['1,240', '812', '390', '38']) expect(within(kpis).getByText(v)).toBeTruthy();
    expect(within(kpis).getByText('31% of joined')).toBeTruthy();
    expect(within(kpis).getByText('65% of joined')).toBeTruthy();
    expect(bodyText()).toContain('Unsubscribed 21 (2%)');
    await waitFor(() => expect(bodyText()).toContain('Messages that failed 3')); // from the delivery report
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('numbers show "—" (not 0 or NaN) when the data is missing', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, entryStats: undefined, snapshot_count: null } });
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    await openDetail();
    const kpis = screen.getByRole('list', { name: 'Journey totals' });
    expect(within(kpis).getAllByText('—').length).toBe(4);
    expect(within(kpis).queryByText(/% of joined/)).toBeNull();
    await waitFor(() => expect(api.getJourneyCampaignAnalytics).toHaveBeenCalledWith(5));
    expect(bodyText()).toContain('Unsubscribed —');
    expect(bodyText()).toContain('Messages that failed —');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('funnel stages and values come from the loaded data, with thousands separators', async () => {
    await openDetail();
    const funnel = await screen.findByRole('list', { name: /Where people drop off/ });
    await waitFor(() => expect(funnel.getAttribute('aria-label')).toContain('Opened 480 (39%)'));
    expect(within(funnel).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'People joined1,240 · 100%', 'Got a message1,200 · 97%', 'Opened480 · 39%', 'Clicked96 · 8%', 'Booked38 · 3%',
    ]);
    expect(funnel.getAttribute('aria-label')).toContain('Got a message 1,200 (97%)');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('funnel skips stages whose data is not available', async () => {
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, nodeAnalytics: [], entryStats: { ...DETAIL.entryStats, exited_booked: undefined } } });
    await openDetail();
    await waitFor(() => expect(api.getJourneyCampaignAnalytics).toHaveBeenCalledWith(5));
    const funnel = await screen.findByRole('list', { name: /Where people drop off/ });
    expect(within(funnel).getAllByRole('listitem').map(li => li.textContent)).toEqual(['People joined1,240 · 100%']);
  });

  it('shows a compact "No data yet" instead of empty charts', async () => {
    vi.mocked(api.getJourneyCampaignAnalytics).mockResolvedValue({});
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, entryStats: undefined, snapshot_count: null, nodeAnalytics: [], node_stats: undefined } });
    await openDetail();
    expect(screen.queryByRole('list', { name: /Where people drop off/ })).toBeNull();
    expect(screen.getAllByText('No data yet').length).toBe(1);
    openSection(/Advanced/);
    expect(screen.queryByTestId('step-chart')).toBeNull();
    expect(screen.getAllByText('No data yet').length).toBe(1);
  });

  it('Steps lists each step on one line, numbered, with waits as connectors', async () => {
    await openDetail();
    const steps = stepsList();
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3); // the entry trigger is not a step
    await waitFor(() => expect(items[0].textContent).toContain("Send email 'Welcome tpl'"));
    expect(items[0].textContent).toContain('Day 1');
    expect(items[0].textContent).toContain('(sent 1,200 · opened 40%)');
    expect(items[0].textContent).toContain('7 now');
    expect(within(items[0]).getByText('Done')).toBeTruthy(); // status dot, in plain words
    expect(items[1].textContent).toContain('Wait 2 days');
    expect(items[2].textContent).toContain("Send WhatsApp 'WA nudge'");
    expect(items[2].textContent).toContain('Day 3');
    expect(items[2].textContent).toContain('2 now');
    expect(within(steps).getByRole('button', { name: /^Step 1: Send email/ })).toBeTruthy();
    expect(bodyText()).toContain('People join: once — everyone in the segment when the journey starts.');
    // The separate "People at each step" chart is not on the Overview.
    expect(screen.queryByTestId('step-chart')).toBeNull();
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

  it('clicking a step opens a slide-over drawer with its details and preview; Escape closes it', async () => {
    vi.mocked(api.previewJourneyNodeEmail).mockResolvedValue({ data: { html: '<p>x</p>' } });
    await openDetail();
    expect(screen.queryByRole('dialog', { name: 'Step details' })).toBeNull();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const drawer = screen.getByRole('dialog', { name: 'Step details' });
    expect(within(drawer).getByText('Step 1 · Welcome email')).toBeTruthy();
    await within(drawer).findByText('Welcome tpl');
    expect(within(drawer).getByText('Subject: Hi there')).toBeTruthy();
    expect(within(drawer).getByText('Last ran')).toBeTruthy();
    expect(within(drawer).getByText('Not yet')).toBeTruthy();
    expect(drawer.textContent).toContain('Done with this step3');
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close step details' }));
    fireEvent.click(within(drawer).getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(api.previewJourneyNodeEmail).toHaveBeenCalledWith(5, 'n1'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Step details' })).toBeNull();
    // The close button closes it too.
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 2:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Step details' })).getByRole('button', { name: 'Close step details' }));
    expect(screen.queryByRole('dialog', { name: 'Step details' })).toBeNull();
  });

  it('step details show last/next run as human Dubai dates', async () => {
    const next = new Date(Date.now() + DAY).toISOString();
    vi.mocked(api.getJourneyTimeline).mockResolvedValue({ data: { journeyId: 5, timeline: [{ nodeId: 'n1', triggeredAt: '2025-01-05T06:00:00Z', nextFireAt: next }] } });
    await openDetail();
    await waitFor(() => expect(api.getJourneyTimeline).toHaveBeenCalledWith(5));
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const drawer = screen.getByRole('dialog', { name: 'Step details' });
    await waitFor(() => expect(drawer.textContent).toContain('Sun, 5 Jan 2025, 10:00 AM'));
    expect(drawer.textContent).toMatch(/Tomorrow \d{1,2}:\d{2} (AM|PM)/);
    expect(drawer.textContent).not.toMatch(ISO);
  });

  it('selecting a step with skipped people offers Retry skipped', async () => {
    vi.mocked(api.retryBlockedEntries).mockResolvedValue({ data: { retried: 4 } });
    await openDetail();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 3:/ }));
    const drawer = screen.getByRole('dialog', { name: 'Step details' });
    expect(within(drawer).getByText('No template set for this step')).toBeTruthy();
    expect(drawer.textContent).toContain('4 people were skipped');
    fireEvent.click(within(drawer).getByRole('button', { name: /Retry skipped/ }));
    await waitFor(() => expect(api.retryBlockedEntries).toHaveBeenCalledWith(5, 'n3'));
  });

  it('step technical details (ids) are tucked away in a collapsed section', async () => {
    await openDetail();
    fireEvent.click(within(stepsList()).getByRole('button', { name: /^Step 1:/ }));
    const drawer = screen.getByRole('dialog', { name: 'Step details' });
    const tech = within(drawer).getByText('Technical details').closest('details');
    expect(tech).toBeTruthy();
    expect(tech?.open).toBe(false);
    expect(within(tech as HTMLElement).getByText('n1')).toBeTruthy();
  });

  it('People tab shows the people table with plain columns and human dates', async () => {
    await openDetail();
    expect(screen.queryByRole('region', { name: 'People in this journey' })).toBeNull(); // not on Overview
    expect(api.getJourneyEntries).not.toHaveBeenCalledWith(5, { page: 1, limit: 50 }); // lazy: not loaded yet
    openSection(/People/);
    expect(window.location.search).toBe('?tab=people');
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenCalledWith(5, { page: 1, limit: 50 }));
    const table = await screen.findByRole('region', { name: 'People in this journey' });
    expect(await within(table).findByText('Asha')).toBeTruthy();
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toEqual(['Contact', 'Current step', 'Status', 'Joined on', 'Next message']);
    expect(within(table).getByText('Step 1 · Welcome email')).toBeTruthy();
    expect(within(table).getByText('In progress')).toBeTruthy();
    expect(table.textContent).toMatch(/Tomorrow \d{1,2}:\d{2} (AM|PM)/);
    expect(table.textContent).toMatch(/\w{3}, \d{1,2} \w{3}/);
    expect(bodyText()).toContain('Who is in this journey (1 person)');
    expect(bodyText()).not.toMatch(/\d{4}-\d{2}-\d{2}T|NaN|undefined/);
  });

  it('the people status filter reloads the list for that status', async () => {
    await openDetail();
    openSection(/People/);
    await screen.findByText('Asha');
    vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [], total: 0 });
    fireEvent.change(screen.getByLabelText('Filter people by status'), { target: { value: 'completed' } });
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 1, limit: 50, status: 'completed' }));
    expect(await screen.findByText('Nobody matches this filter')).toBeTruthy();
  });

  it('people search sends q to the API (with the status filter), pages keep it, and clear resets', async () => {
    await openDetail();
    openSection(/People/);
    await screen.findByText('Asha');
    const box = screen.getByRole('textbox', { name: 'Search people' });
    fireEvent.change(box, { target: { value: '  vaibhav ' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 1, limit: 50, q: 'vaibhav' }));
    fireEvent.change(screen.getByLabelText('Filter people by status'), { target: { value: 'active' } });
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 1, limit: 50, status: 'active', q: 'vaibhav' }));
    vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [], total: 0 });
    fireEvent.change(box, { target: { value: 'zzz' } });
    fireEvent.blur(box);
    expect(await screen.findByText('Nobody matches “zzz”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear people search' }));
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 1, limit: 50, status: 'active' }));
  });

  it('people paging asks for the next page', async () => {
    vi.mocked(api.getJourneyEntries).mockResolvedValue({
      data: [{ entry_id: 1, name: 'Asha', status: 'active', current_node_id: 'n1' }],
      total: 120,
    });
    await openDetail();
    openSection(/People/);
    await screen.findByText('Asha');
    expect(bodyText()).toContain('Page 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.getJourneyEntries).toHaveBeenLastCalledWith(5, { page: 2, limit: 50 }));
  });

  it('a failed people load shows a plain error with Try again', async () => {
    vi.mocked(api.getJourneyEntries).mockRejectedValue(new Error('boom'));
    await openDetail();
    openSection(/People/);
    expect(await screen.findByText("We couldn't load the people in this journey")).toBeTruthy();
    vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [{ entry_id: 2, name: 'Ravi', status: 'completed', current_node_id: 'n3' }], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Ravi')).toBeTruthy();
  });

  it('the Overview uses no jargon (node, trigger, snapshot, fire time, entries) and no ISO dates', async () => {
    await openDetail();
    await screen.findByText('Where people drop off');
    // Opening a journey no longer pulls 200 entries just to find the busiest step (it reads node_stats).
    expect(api.getJourneyEntries).not.toHaveBeenCalled();
    expect(bodyText()).not.toMatch(/\bnodes?\b|trigger|snapshot|fire time|next fire|\bentr(y|ies)\b/i);
    expect(bodyText()).not.toMatch(ISO);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(bodyText()).toContain('Where people drop off');
    expect(bodyText()).toContain('Steps');
  });

  it('the Flow tab shows the flow builder; Advanced content is not rendered there or on Overview', async () => {
    await openDetail();
    expect(screen.queryByText('Flow builder')).toBeNull();
    openSection(/Flow/);
    expect(window.location.search).toBe('');
    const panel = screen.getByRole('tabpanel', { name: 'Flow' });
    expect(within(panel).getByText('Flow builder')).toBeTruthy();
    expect(within(panel).getByText('4 steps')).toBeTruthy(); // visual flow of this journey (incl. the entry)
    expect(screen.queryByRole('tablist', { name: 'Advanced tools' })).toBeNull();
    openSection(/Overview/);
    expect(window.location.search).toBe('?tab=overview');
    expect(screen.queryByText('Flow builder')).toBeNull();
  });

  it('"Open flow builder" on the Steps card switches to the Flow tab', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Open flow builder/ }));
    expect(sectionTab(/Flow/).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel', { name: 'Flow' })).getByText('Flow builder')).toBeTruthy();
  });

  it('Advanced tab holds the queue, the step chart, technical details and the other tools — none of it on Overview', async () => {
    await openDetail();
    expect(screen.queryByRole('tablist', { name: 'Advanced tools' })).toBeNull();
    expect(bodyText()).not.toContain('9 scheduled');
    expect(bodyText()).not.toContain('Journey ID5');
    openSection(/Advanced/);
    expect(window.location.search).toBe('?tab=advanced');
    const tabs = screen.getByRole('tablist', { name: 'Advanced tools' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent?.trim())).toEqual(['People', 'Analytics', 'Activity', 'Settings']);
    expect(within(tabs).getByRole('tab', { name: /Analytics/ }).getAttribute('aria-selected')).toBe('true');
    expect(bodyText()).toContain('9 scheduled');
    expect(bodyText()).toContain('2 failed');
    expect(bodyText()).toContain('Journey ID5');
    fireEvent.click(within(tabs).getByRole('tab', { name: /Settings/ }));
    expect(screen.getByText('Journey Configuration')).toBeTruthy();
    openSection(/Overview/);
    expect(screen.queryByRole('tablist', { name: 'Advanced tools' })).toBeNull();
  });

  it('"People at each step" chart (Advanced) has one bar per step and clicking a bar opens that step', async () => {
    await openDetail();
    openSection(/Advanced/);
    const chart = screen.getByTestId('step-chart');
    const bars = within(chart).getAllByRole('button');
    expect(bars).toHaveLength(3);
    expect(bars[1].textContent).toBe('bar 2 · Wait 2 days=0');
    expect(bars[2].textContent).toBe('bar 3 · WhatsApp: WA nudge=2');
    expect(screen.queryByRole('dialog', { name: 'Step details' })).toBeNull();
    fireEvent.click(bars[2]);
    const drawer = screen.getByRole('dialog', { name: 'Step details' });
    expect(within(drawer).getByText('Step 3 · WA nudge')).toBeTruthy();
    expect(screen.getByRole('img', { name: /People at each step: 1 · Email/ })).toBeTruthy();
  });

  it('opens the tab named in the URL (?tab=people)', async () => {
    window.history.replaceState(null, '', '/journeys/5?tab=people');
    renderPage();
    await screen.findByRole('heading', { name: 'Welcome Series' });
    expect(sectionTab(/People/).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('region', { name: 'People in this journey' })).toBeTruthy();
  });

  it('More menu items switch to the right tab', async () => {
    vi.mocked(api.aiFlowSuggest).mockResolvedValue({ data: { overall_score: 80, suggestions: [] } });
    await openDetail();
    const more = () => { fireEvent.click(screen.getByRole('button', { name: /More/ })); return screen.getByRole('menu'); };
    const menu = more();
    for (const l of ['Edit steps', 'AI flow assist', 'Full people list', 'Analytics', 'Activity', 'Settings', 'Copy journey ID', 'Delete journey']) {
      expect(within(menu).getByText(l)).toBeTruthy();
    }
    fireEvent.click(within(menu).getByText('Edit steps'));
    expect(sectionTab(/Flow/).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel', { name: 'Flow' })).getByText('Flow builder')).toBeTruthy();

    fireEvent.click(within(more()).getByText('AI flow assist'));
    await waitFor(() => expect(api.aiFlowSuggest).toHaveBeenCalled());
    expect(sectionTab(/Advanced/).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(within(more()).getByText('Full people list'));
    expect(sectionTab(/People/).getAttribute('aria-selected')).toBe('true');

    for (const [item, tab] of [['Analytics', /Analytics/], ['Activity', /Activity/], ['Settings', /Settings/]] as const) {
      fireEvent.click(within(more()).getByText(item));
      expect(sectionTab(/Advanced/).getAttribute('aria-selected')).toBe('true');
      expect(within(screen.getByRole('tablist', { name: 'Advanced tools' })).getByRole('tab', { name: tab }).getAttribute('aria-selected')).toBe('true');
    }

    fireEvent.click(within(more()).getByText('Delete journey'));
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
