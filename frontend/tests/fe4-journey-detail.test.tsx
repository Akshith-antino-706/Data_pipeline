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

class RO { observe(): void {} unobserve(): void {} disconnect(): void {} }

const DETAIL = {
  journey_id: 5, name: 'Welcome Series', status: 'active', journey_type: 'fixed', segment_name: 'New sign-ups',
  conversion_rate: '0', snapshot_count: 1240,
  entryStats: { total_entries: '1240', active: '812', completed: '390', exited_booked: '38', exited_unsubscribed: '21', pre_existing_unsub: 0 },
  nodes: [
    { id: 'n0', type: 'trigger', data: { label: 'Start' } },
    { id: 'n1', type: 'action', data: { label: 'Welcome email', channel: 'email', emailTemplateId: 11 } },
    { id: 'n2', type: 'wait', data: { label: 'Wait a bit', waitDays: 2, waitUnit: 'days' } },
    { id: 'n3', type: 'action', data: { label: 'WA nudge', channel: 'whatsapp' } },
  ],
  edges: [],
  nodeAnalytics: [{ node_id: 'n3', event_type: 'action_blocked', event_count: '4' }],
  node_stats: { n1: { active: 7, completed: 3, exited_booked: 0, exited: 0 } },
  node_statuses: { n1: 'completed' },
};

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
  vi.mocked(api.getJourneyEntries).mockResolvedValue({ data: [{ entry_id: 1, name: 'Asha', email: 'asha@x.com', status: 'active', current_node_id: 'n1' }], total: 1 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const bodyText = (): string => document.body.textContent ?? '';
const renderPage = () => render(<BusinessTypeProvider><Journeys /></BusinessTypeProvider>);
const openDetail = async () => { renderPage(); await screen.findByRole('heading', { name: 'Welcome Series' }); };

describe('Journey detail', () => {
  it('/journeys/5 loads journey 5; "All journeys" goes back to /journeys and shows the list', async () => {
    await openDetail();
    expect(api.getJourney).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: /All journeys/ }));
    expect(window.location.pathname).toBe('/journeys');
    await waitFor(() => expect(screen.queryByRole('button', { name: /All journeys/ })).toBeNull());
  });

  it('shows a loading skeleton while the journey loads', async () => {
    vi.mocked(api.getJourney).mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Loading journey')).toBeTruthy());
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('shows the header with status, type, channels and segment', async () => {
    await openDetail();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('One-time')).toBeTruthy();
    expect(screen.getByText('Email + WhatsApp')).toBeTruthy();
    expect(screen.getByText('Segment: New sign-ups')).toBeTruthy();
  });

  it('KPIs come from entryStats', async () => {
    await openDetail();
    const kpis = screen.getByLabelText('Journey totals');
    for (const v of ['1,240', '812', '390', '21', '38']) expect(within(kpis).getByText(v)).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('KPIs show 0 (not NaN) when entryStats is missing', async () => {
    vi.mocked(api.getJourney).mockResolvedValue({ data: { ...DETAIL, entryStats: undefined, snapshot_count: null } });
    await openDetail();
    expect(within(screen.getByLabelText('Journey totals')).getAllByText('0').length).toBeGreaterThan(3);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
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

  it('Edit opens the rename form and Save calls updateJourney', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Journey name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateJourney).toHaveBeenCalled());
    expect(vi.mocked(api.updateJourney).mock.calls[0][0]).toBe(5);
  });

  it('step panel shows the selected step and previews the template', async () => {
    vi.mocked(api.previewJourneyNodeEmail).mockResolvedValue({ data: { html: '<p>x</p>' } });
    await openDetail();
    const steps = screen.getByRole('list', { name: 'Journey steps' });
    expect(within(steps).getByText('Welcome email')).toBeTruthy();
    expect(within(steps).queryByText('Start')).toBeNull();
    const panel = await screen.findByLabelText('Step details');
    await within(panel).findByText('Welcome tpl');
    fireEvent.click(within(panel).getByRole('button', { name: /Preview/ }));
    await waitFor(() => expect(api.previewJourneyNodeEmail).toHaveBeenCalledWith(5, 'n1'));
  });

  it('selecting a step with skipped contacts offers Retry skipped', async () => {
    vi.mocked(api.retryBlockedEntries).mockResolvedValue({ data: { retried: 4 } });
    await openDetail();
    fireEvent.click(within(screen.getByRole('list', { name: 'Journey steps' })).getByText('WA nudge'));
    const panel = screen.getByLabelText('Step details');
    expect(within(panel).getByText('No template set for this step')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /Retry skipped/ }));
    await waitFor(() => expect(api.retryBlockedEntries).toHaveBeenCalledWith(5, 'n3'));
  });

  it('shows delivery queue counts and the contacts table', async () => {
    await openDetail();
    expect(await screen.findByText('Asha')).toBeTruthy();
    expect(api.getJourneyEntries).toHaveBeenCalled();
    expect(bodyText()).toContain('9 scheduled');
    expect(bodyText()).toContain('2 failed');
  });

  it('More menu holds the less common actions', async () => {
    vi.mocked(api.aiFlowSuggest).mockResolvedValue({ data: { overall_score: 80, suggestions: [] } });
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const menu = screen.getByRole('menu');
    for (const l of ['Edit steps (flow builder)', 'AI flow assist', 'Analytics', 'Copy journey ID', 'Delete journey']) {
      expect(within(menu).getByText(l)).toBeTruthy();
    }
    fireEvent.click(within(menu).getByText('AI flow assist'));
    await waitFor(() => expect(api.aiFlowSuggest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Delete journey'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a failed detail load returns to the list with an error toast', async () => {
    vi.mocked(api.getJourney).mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(bodyText()).toContain('Failed to load journey'));
    expect(window.location.pathname).toBe('/journeys');
  });
});
