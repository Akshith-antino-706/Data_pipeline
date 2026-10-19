// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import Journeys from '@/app/(dashboard)/journeys/page';

vi.mock('@/lib/api');
const nav = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>(), search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.replace, replace: nav.replace, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/journeys',
  useSearchParams: () => nav.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn<(m: string) => void>(), error: vi.fn<(m: string) => void>() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

class RO { observe(): void {} unobserve(): void {} disconnect(): void {} }

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.search = new URLSearchParams();
  localStorage.setItem('business-type', 'All');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled'))));
  vi.stubGlobal('ResizeObserver', RO);
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(api.getJourneys).mockResolvedValue({ data: [] });
  vi.mocked(api.getSegmentationTree).mockResolvedValue({ statusCounts: [{ booking_status: 'FUTURE_TRAVEL', count: 1200 }], breakdown: [] });
  vi.mocked(api.getCustomSegments).mockResolvedValue({ data: [{ id: 9, name: 'VIP travellers', cached_count: 42 }] });
  vi.mocked(api.getTemplates).mockResolvedValue({ data: [{ id: 11, name: 'Welcome tpl', subject: 'Hi there', channel: 'email' }] });
  vi.mocked(api.createJourney).mockResolvedValue({ data: { name: 'Visa reminder', journey_id: 77 } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const bodyText = (): string => document.body.textContent ?? '';
const clean = () => expect(bodyText()).not.toMatch(/NaN|undefined/);
const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const next = () => fireEvent.click(btn('Next'));
const heading = (name: string) => screen.getByRole('heading', { name });

async function openWizard() {
  render(<BusinessTypeProvider><Journeys /></BusinessTypeProvider>);
  await screen.findByText('Create your first journey');
  fireEvent.click(screen.getAllByRole('button', { name: /Create journey/i })[0]);
  await screen.findByRole('heading', { name: 'What is this journey for?' });
}

function fillBasics(name = 'Visa reminder', desc = 'Reminds travellers') {
  fireEvent.change(screen.getByPlaceholderText('e.g., Welcome Series — New Customers'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('Describe the purpose and target audience...'), { target: { value: desc } });
}

async function pickSegment(label: RegExp) {
  const opener = await screen.findByRole('button', { name: /Select a segment/ });
  fireEvent.click(opener);
  fireEvent.mouseDown(screen.getByText(label));
}

async function addWaitNode() {
  fireEvent.click(btn(/Add First Node/));
  fireEvent.click(btn(/Wait \/ Delay/));
  const adds = screen.getAllByRole('button', { name: /Add Node/ });
  fireEvent.click(adds[adds.length - 1]);
  await screen.findByText('Wait 1 Day');
}

describe('Create journey wizard', () => {
  it('step indicator marks the current step and blocks unreachable steps', async () => {
    await openWizard();
    const nav = screen.getByRole('navigation', { name: 'Wizard steps' });
    expect(nav.querySelectorAll('li').length).toBe(5);
    expect(btn(/Basics/).getAttribute('aria-current')).toBe('step');
    expect((btn(/Review/) as HTMLButtonElement).disabled).toBe(true);
    expect((btn('Back') as HTMLButtonElement).disabled).toBe(true);
    clean();
  });

  it('validates every step and moves with Back / Next', async () => {
    await openWizard();
    // Step 1 — name required
    next();
    expect(screen.getByText('Give the journey a name.')).toBeTruthy();
    expect(screen.getByLabelText(/Journey name/).getAttribute('aria-invalid')).toBe('true');
    fillBasics();
    next();
    // Step 2 — giveaway needs a type
    expect(heading('How do people join?')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Whenever something happens/ }));
    fireEvent.click(btn('Giveaway'));
    next();
    expect(screen.getByText('Pick at least one giveaway type.')).toBeTruthy();
    fireEvent.click(btn(/winner/));
    expect(btn(/winner/).getAttribute('aria-pressed')).toBe('true');
    // Back keeps what was typed
    fireEvent.click(btn('Back'));
    expect((screen.getByPlaceholderText('e.g., Welcome Series — New Customers') as HTMLInputElement).value).toBe('Visa reminder');
    next();
    next();
    // Step 3 — segment required
    expect(heading('Who should get it?')).toBeTruthy();
    await screen.findByRole('button', { name: /Select a segment/ });
    next();
    expect(screen.getByText('Pick a segment.')).toBeTruthy();
    await pickSegment(/VIP travellers/);
    next();
    // Step 4 — at least one node, and not mid-edit
    expect(heading('What happens, step by step?')).toBeTruthy();
    next();
    expect(screen.getByText('Add at least one step after the entry trigger.')).toBeTruthy();
    fireEvent.click(btn(/Add First Node/));
    next();
    expect(screen.getByText('Finish or cancel the step you are editing first.')).toBeTruthy();
    fireEvent.click(btn(/Wait \/ Delay/));
    const adds = screen.getAllByRole('button', { name: /Add Node/ });
    fireEvent.click(adds[adds.length - 1]);
    next();
    // Step 5 — review
    expect(heading('Review and create')).toBeTruthy();
    expect(bodyText()).toContain('VIP travellers (42)');
    expect(bodyText()).toContain('winner');
    expect(btn(/Steps/).getAttribute('aria-current')).toBeNull();
    // Change jumps back
    fireEvent.click(btn('Change segment'));
    expect(heading('Who should get it?')).toBeTruthy();
    expect(api.createJourney).not.toHaveBeenCalled();
    clean();
  });

  it('sends exactly the old create payload for a fixed journey', async () => {
    await openWizard();
    fillBasics();
    next();
    next();
    await pickSegment(/Future Travel/);
    fireEvent.click(screen.getByRole('switch'));  // stop-on-booking off
    next();
    await addWaitNode();
    next();
    fireEvent.click(btn('Create journey'));
    await waitFor(() => expect(api.createJourney).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.createJourney).mock.calls[0][0] as Record<string, unknown>;
    // Exactly the keys the old form sent — no more, no fewer.
    expect(Object.keys(payload).sort()).toEqual([
      'description', 'edges', 'emailCredential', 'exitOnConversion', 'journeyType', 'name', 'nodes',
      'recommendationType', 'scheduledStartAt', 'segmentId', 'testEmail', 'testMode', 'testWaitSec',
      'triggerEvent', 'triggerFromDate', 'triggerSource',
    ]);
    const { scheduledStartAt, ...rest } = payload;
    // Pre-filled Dubai now+10min, converted to UTC ISO exactly as before.
    expect(String(scheduledStartAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(rest).toEqual({
      name: 'Visa reminder',
      description: 'Reminds travellers',
      segmentId: 'FUTURE_TRAVEL',
      journeyType: 'fixed',
      triggerSource: 'gtm',
      triggerEvent: null,
      triggerFromDate: null,
      exitOnConversion: false,
      testMode: false,
      testEmail: null,
      testWaitSec: 30,
      recommendationType: null,
      emailCredential: 'default',
      nodes: [
        { id: 'node_0', type: 'trigger', data: { triggerType: 'segment_entry', label: 'Entry Point', segmentId: 'FUTURE_TRAVEL' }, position: { x: 300, y: 50 } },
        {
          id: 'node_1', type: 'wait',
          data: {
            label: 'Wait 1 Day', channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking', sendHour: undefined,
            emailTemplateId: undefined, whatsappTemplateId: undefined, smsTemplateId: undefined,
            restChannel: 'email', restTemplateId: undefined, templateVariables: undefined,
          },
          position: { x: 300, y: 170 },
        },
      ],
      edges: [{ id: 'e_node_0_node_1', source: 'node_0', target: 'node_1' }],
    });
    // Success: wizard closes, sticky toast shows, list reloads
    await screen.findByText(/is being created — building audience/);
    expect(screen.queryByRole('heading', { name: 'Review and create' })).toBeNull();
    clean();
  });

  it('continuous giveaway journey sends trigger source, events and from-date like before', async () => {
    await openWizard();
    fillBasics('Giveaway follow-up', '');
    next();
    fireEvent.click(screen.getByRole('radio', { name: /Whenever something happens/ }));
    fireEvent.click(btn('Giveaway'));
    fireEvent.click(btn(/participation/));
    fireEvent.click(btn(/winner/));
    fireEvent.change(screen.getByLabelText(/Trigger only for events on or after/), { target: { value: '2026-10-01' } });
    next();
    await pickSegment(/VIP travellers/);
    next();
    await addWaitNode();
    next();
    fireEvent.click(btn('Create journey'));
    await waitFor(() => expect(api.createJourney).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.createJourney).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: 'Giveaway follow-up', description: '', segmentId: 'custom:9', journeyType: 'continuous',
      triggerSource: 'giveaway', triggerEvent: 'participation,winner',
      triggerFromDate: new Date('2026-10-01T00:00:00+04:00').toISOString(),
      exitOnConversion: true, emailCredential: 'default', recommendationType: null,
      testMode: false, testEmail: null, testWaitSec: 30,
    });
  });

  it('keeps the wizard open and shows the error when create fails', async () => {
    vi.mocked(api.createJourney).mockRejectedValue(new Error('Segment snapshot failed'));
    await openWizard();
    fillBasics();
    next(); next();
    await pickSegment(/Future Travel/);
    next();
    await addWaitNode();
    next();
    fireEvent.click(btn('Create journey'));
    await screen.findByText('Segment snapshot failed');
    expect(heading('Review and create')).toBeTruthy();
    expect((btn('Create journey') as HTMLButtonElement).disabled).toBe(false);
    clean();
  });

  it('cancel with unsaved changes asks first; keep editing stays, discard leaves', async () => {
    await openWizard();
    fillBasics();
    fireEvent.click(btn('Cancel'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Discard this journey?')).toBeTruthy();
    fireEvent.click(btn('Keep editing'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByPlaceholderText('e.g., Welcome Series — New Customers') as HTMLInputElement).value).toBe('Visa reminder');
    fireEvent.click(btn('Cancel'));
    fireEvent.click(btn('Discard'));
    await screen.findByText('Create your first journey');
    expect(api.createJourney).not.toHaveBeenCalled();
  });

  it('cancel without changes closes straight away', async () => {
    await openWizard();
    fireEvent.click(btn('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await screen.findByText('Create your first journey');
  });
});
