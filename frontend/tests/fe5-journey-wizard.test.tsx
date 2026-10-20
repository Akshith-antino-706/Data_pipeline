// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import Journeys from '@/app/(dashboard)/journeys/page';
import NewJourneyRoute from '@/app/(dashboard)/journeys/new/page';
import { formatStart } from '@/app/(dashboard)/journeys/JourneyWizard';
import { cleanSegmentLabel, defaultNodeName, isGeneratedName, pluralSteps, uniqueName } from '@/app/(dashboard)/journeys/nodeNames';
import type { NodeForm } from '@/types/f1Journeys';

vi.mock('@/lib/api');
const nav = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>(), search: new URLSearchParams(), pathname: '/journeys/new' }));
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

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.search = new URLSearchParams();
  nav.pathname = '/journeys/new';
  nav.replace.mockReset();
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

const radio = (name: string | RegExp) => screen.getByRole('radio', { name });
const nameInput = () => screen.getByLabelText(/Node name/) as HTMLInputElement;

/** /journeys/new renders the wizard straight away. */
async function openWizard() {
  render(<BusinessTypeProvider><NewJourneyRoute /></BusinessTypeProvider>);
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
  fireEvent.click(btn(/Add (first|another) node/));
  fireEvent.click(radio(/Wait \/ Delay/));
  fireEvent.click(btn('Add node'));
  await screen.findAllByText('Wait 1 day');
}

/** Basics → (fixed) → segment → the Steps step. */
async function goToSteps(segment: RegExp = /Future Travel/) {
  await openWizard();
  fillBasics();
  next();
  next();
  await pickSegment(segment);
  next();
  await screen.findByRole('heading', { name: 'What happens, step by step?' });
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
    fireEvent.click(btn(/Add first node/));
    next();
    expect(screen.getByText('Finish or cancel the step you are editing first.')).toBeTruthy();
    fireEvent.click(radio(/Wait \/ Delay/));
    fireEvent.click(btn('Add node'));
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
            label: 'Wait 1 day', channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking', sendHour: undefined,
            emailTemplateId: undefined, whatsappTemplateId: undefined, smsTemplateId: undefined,
            restChannel: 'email', restTemplateId: undefined, templateVariables: undefined,
          },
          position: { x: 300, y: 170 },
        },
      ],
      edges: [{ id: 'e_node_0_node_1', source: 'node_0', target: 'node_1' }],
    });
    // Success: wizard closes, sticky toast shows, list reloads (URL swapped to /journeys in place)
    await screen.findByText(/is being created — building audience/);
    expect(screen.queryByRole('heading', { name: 'Review and create' })).toBeNull();
    expect(window.location.pathname).toBe('/journeys');
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
    expect(nav.replace).toHaveBeenCalledWith('/journeys');
    expect(api.createJourney).not.toHaveBeenCalled();
  });

  it('cancel without changes closes straight away', async () => {
    await openWizard();
    fireEvent.click(btn('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith('/journeys');
  });

  it('the in-page list still opens on /journeys (no wizard)', async () => {
    nav.pathname = '/journeys';
    render(<BusinessTypeProvider><Journeys /></BusinessTypeProvider>);
    await screen.findByText('Create your first journey');
    expect(screen.queryByRole('heading', { name: 'What is this journey for?' })).toBeNull();
  });

  it('horizontal stepper: aria-current, done state, progress and focus on the heading', async () => {
    await openWizard();
    const stepper = screen.getByRole('navigation', { name: 'Wizard steps' });
    const items = stepper.querySelectorAll('li');
    expect(items[0].getAttribute('data-state')).toBe('current');
    expect(screen.getByRole('progressbar', { name: 'Wizard progress' }).getAttribute('aria-valuenow')).toBe('1');
    fillBasics();
    next();
    expect(btn(/Who joins/).getAttribute('aria-current')).toBe('step');
    expect(btn(/Basics/).getAttribute('aria-current')).toBeNull();
    expect(btn(/Basics/).textContent).toContain('(done)');
    expect(btn(/Who joins/).textContent).toContain('(current step)');
    expect(items[0].getAttribute('data-state')).toBe('done');
    expect(items[1].getAttribute('data-state')).toBe('current');
    expect(items[2].getAttribute('data-state')).toBe('todo');
    expect(btn(/Basics/).querySelector('[aria-hidden="true"]')?.textContent).toBe('✓');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    expect(bodyText()).toContain('Step 2 of 5 · Who joins');
    expect(document.activeElement).toBe(heading('How do people join?'));
    // Done steps can be revisited from the stepper.
    fireEvent.click(btn(/Basics/));
    expect(heading('What is this journey for?')).toBeTruthy();
  });

  it('node form: no validation error until Add node is tried, then inline under the field', async () => {
    await goToSteps();
    fireEvent.click(btn(/Add first node/));
    expect(radio(/Send message/).getAttribute('aria-checked')).toBe('true');
    expect(radio('Email').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Email template is required')).toBeNull();
    fireEvent.click(btn('Add node'));
    const err = screen.getByText('Email template is required');
    expect(err.getAttribute('role')).toBe('alert');
    expect(bodyText()).toContain('0 steps');
    // Fixing it lets the node in.
    fireEvent.click(await screen.findByRole('button', { name: /Select email template/ }));
    fireEvent.mouseDown(await screen.findByText('Welcome tpl'));
    expect(screen.queryByText('Email template is required')).toBeNull();
    fireEvent.click(btn('Add node'));
    await screen.findAllByText('Email: Welcome tpl');
    expect(api.createJourney).not.toHaveBeenCalled();
  });

  it('default names follow the choices for every type and channel', async () => {
    vi.mocked(api.getTemplates).mockResolvedValue({ data: [
      { id: 11, name: 'Welcome tpl', subject: 'Hi there', channel: 'email' },
      { id: 12, name: 'Visa SMS', channel: 'sms' },
    ] });
    vi.mocked(api.getWhatsAppChannels).mockResolvedValue({ data: [{ id: 'c1', name: 'Rayna main' }] });
    vi.mocked(api.getWhatsAppTemplates).mockResolvedValue({ data: [{ id: 't9', name: 'Diwali offer' }] });
    vi.mocked(api.getRcsTemplates).mockResolvedValue({ data: [{ code: 'oct_promo', name: 'October promo' }] });
    await goToSteps();
    fireEvent.click(btn(/Add first node/));
    expect(nameInput().value).toBe('Send email');
    fireEvent.click(await screen.findByRole('button', { name: /Select email template/ }));
    fireEvent.mouseDown(await screen.findByText('Welcome tpl'));
    expect(nameInput().value).toBe('Email: Welcome tpl');

    fireEvent.click(radio('SMS'));
    expect(nameInput().value).toBe('Send SMS');
    fireEvent.click(screen.getByRole('button', { name: /Select sms template/ }));
    fireEvent.mouseDown(await screen.findByText('Visa SMS'));
    expect(nameInput().value).toBe('SMS: Visa SMS');

    fireEvent.click(radio('WhatsApp'));
    expect(nameInput().value).toBe('Send WhatsApp');
    const waGroup = screen.getByRole('group', { name: 'WhatsApp template' });
    await waitFor(() => expect(waGroup.querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(waGroup.querySelectorAll('select')[0], { target: { value: 'c1' } });
    await waitFor(() => expect(waGroup.querySelectorAll('select')[1].querySelectorAll('option').length).toBe(2));
    fireEvent.change(waGroup.querySelectorAll('select')[1], { target: { value: 't9' } });
    expect(nameInput().value).toBe('WhatsApp: Diwali offer');

    fireEvent.click(radio('RCS'));
    expect(nameInput().value).toBe('Send RCS');
    const rcsGroup = screen.getByRole('group', { name: 'RCS template' });
    await waitFor(() => expect(rcsGroup.querySelector('select')).toBeTruthy());
    fireEvent.change(rcsGroup.querySelector('select') as HTMLSelectElement, { target: { value: 'oct_promo' } });
    expect(nameInput().value).toBe('RCS: October promo');

    fireEvent.click(radio(/Wait \/ Delay/));
    expect(nameInput().value).toBe('Wait 1 day');
    fireEvent.click(btn('3 days'));
    expect(nameInput().value).toBe('Wait 3 days');

    fireEvent.click(radio(/Branch/));
    expect(nameInput().value).toBe('Branch: Has booked?');
    fireEvent.click(radio('Opened email?'));
    expect(nameInput().value).toBe('Branch: Opened email?');

    fireEvent.click(radio(/Conversion goal/));
    expect(nameInput().value).toBe('Goal: Booking');
    fireEvent.click(radio('Enquiry'));
    expect(nameInput().value).toBe('Goal: Enquiry');
    fireEvent.click(btn('Add node'));
    await screen.findAllByText('Goal: Enquiry');
  });

  it('a name the user typed is never overwritten', async () => {
    await goToSteps();
    fireEvent.click(btn(/Add first node/));
    fireEvent.change(nameInput(), { target: { value: 'My welcome' } });
    fireEvent.click(radio('SMS'));
    fireEvent.click(radio(/Wait \/ Delay/));
    fireEvent.click(btn('7 days'));
    expect(nameInput().value).toBe('My welcome');
    fireEvent.click(btn('Add node'));
    await screen.findAllByText('My welcome');
    // Editing keeps the custom name too.
    fireEvent.click(btn('Edit My welcome'));
    fireEvent.click(btn('2 days'));
    expect(nameInput().value).toBe('My welcome');
    // Clearing it and trying to save asks for a name instead of silently refilling it.
    fireEvent.change(nameInput(), { target: { value: '' } });
    fireEvent.click(btn('Save changes'));
    expect(screen.getByText('Give this node a name.')).toBeTruthy();
  });

  it('duplicate default names get a number; "1 step" / "2 steps"', async () => {
    await goToSteps();
    expect(bodyText()).toContain('0 steps');
    await addWaitNode();
    expect(bodyText()).toContain('1 step');
    expect(bodyText()).not.toMatch(/1 nodes|1 steps/);
    await addWaitNode();
    await screen.findAllByText('Wait 1 day (2)');
    expect(bodyText()).toContain('2 steps');
    // A generated name keeps following the choices while editing.
    fireEvent.click(btn('Edit Wait 1 day (2)'));
    fireEvent.click(btn('3 days'));
    expect(nameInput().value).toBe('Wait 3 days');
    fireEvent.click(btn('Save changes'));
    await screen.findAllByText('Wait 3 days');
    // Reorder and remove still work.
    fireEvent.click(btn('Move Wait 3 days up'));
    const steps = screen.getByRole('list', { name: 'Steps in this journey' });
    expect(Array.from(steps.querySelectorAll('b')).map(b => b.textContent)).toEqual(['Entry trigger', 'Wait 3 days', 'Wait 1 day']);
    fireEvent.click(btn('Remove Wait 1 day'));
    expect(bodyText()).toContain('1 step');
  });

  it('summary: segment count once, steps update live, start time formatted', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: [{ id: 4, name: 'Test Contacts — B2C (4)', cached_count: 4 }] });
    await goToSteps(/Test Contacts/);
    const summary = screen.getByRole('complementary', { name: 'Summary' });
    expect(summary.textContent).toContain('Test Contacts — B2C (4)');
    expect(summary.textContent).not.toContain('(4) (4)');
    expect(summary.textContent).toContain('0 steps');
    await addWaitNode();
    expect(summary.textContent).toContain('1 step');
    expect(summary.textContent).toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Z][a-z]{2} \d{4} · \d{1,2}:\d{2} (AM|PM) \(Dubai\)/);
    expect(summary.textContent).not.toMatch(/Dubai time/);
  });
});

describe('node naming and formatting helpers', () => {
  const ctx = { emailTemplates: [{ id: 11, name: 'Welcome tpl' }], smsTemplates: [{ id: 12, name: 'Visa SMS' }], continuous: true };
  const base: NodeForm = {
    label: '', type: 'action', channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking',
    emailTemplateId: null, whatsappTemplateId: null, smsTemplateId: null, restChannel: 'email', restTemplateId: null,
    waChannelId: null, waChannelName: null, waTemplateId: null, waTemplateName: null,
    rcsTemplateCode: null, rcsTemplateName: null, rcsTemplateType: null, sendHour: null, templateVariables: {},
  };
  const n = (o: Partial<NodeForm>): NodeForm => ({ ...base, ...o });

  it('names every type and channel', () => {
    expect(defaultNodeName(n({}), ctx)).toBe('Send email');
    expect(defaultNodeName(n({ emailTemplateId: 11 }), ctx)).toBe('Email: Welcome tpl');
    expect(defaultNodeName(n({ channel: 'whatsapp', waTemplateName: 'Diwali offer' }), ctx)).toBe('WhatsApp: Diwali offer');
    expect(defaultNodeName(n({ channel: 'sms', smsTemplateId: 12 }), ctx)).toBe('SMS: Visa SMS');
    expect(defaultNodeName(n({ channel: 'rcs', rcsTemplateCode: 'oct', rcsTemplateName: 'October promo' }), ctx)).toBe('RCS: October promo');
    expect(defaultNodeName(n({ type: 'wait', waitDays: 2 }), ctx)).toBe('Wait 2 days');
    expect(defaultNodeName(n({ type: 'wait', waitDays: 3 / 24, waitUnit: 'hours' }), ctx)).toBe('Wait 3 hours');
    expect(defaultNodeName(n({ type: 'wait', waitDays: 30 / 1440 }), ctx)).toBe('Wait 30 minutes');
    expect(defaultNodeName(n({ type: 'wait', waitDays: 2 }), { ...ctx, continuous: false })).toBe('Wait 2 days');
    expect(defaultNodeName(n({ type: 'wait', sendHour: '10:00' }), ctx)).not.toMatch(/until/);
    expect(defaultNodeName(n({ type: 'condition', condition: 'clicked_link' }), ctx)).toBe('Branch: Clicked link?');
    expect(defaultNodeName(n({ type: 'condition', condition: '' }), ctx)).toBe('Branch');
    expect(defaultNodeName(n({ type: 'goal', goalType: 'registration' }), ctx)).toBe('Goal: Registration');
    expect(defaultNodeName(n({ type: 'goal', goalType: '' }), ctx)).toBe('Conversion goal');
  });

  it('numbers duplicates and recognises generated names', () => {
    expect(uniqueName('Wait 1 day', [])).toBe('Wait 1 day');
    expect(uniqueName('Wait 1 day', ['Wait 1 day'])).toBe('Wait 1 day (2)');
    expect(uniqueName('Wait 1 day', ['Wait 1 day', 'Wait 1 day (2)'])).toBe('Wait 1 day (3)');
    expect(isGeneratedName('Send email (2)', n({}), ctx)).toBe(true);
    expect(isGeneratedName('My welcome', n({}), ctx)).toBe(false);
  });

  it('pluralises, cleans segment counts and formats the start time', () => {
    expect(pluralSteps(0)).toBe('0 steps');
    expect(pluralSteps(1)).toBe('1 step');
    expect(pluralSteps(2)).toBe('2 steps');
    expect(cleanSegmentLabel('Test Contacts — B2C (4) (4)')).toBe('Test Contacts — B2C (4)');
    expect(cleanSegmentLabel('VIP travellers (42)')).toBe('VIP travellers (42)');
    expect(formatStart('2026-10-20T13:41')).toBe('Tue, 20 Oct 2026 · 1:41 PM (Dubai)');
    expect(formatStart('2026-10-21T00:05')).toBe('Wed, 21 Oct 2026 · 12:05 AM (Dubai)');
    expect(formatStart('')).toBe('About 10 minutes after creating');
  });
});
