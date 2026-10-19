// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import Content from '@/app/(dashboard)/content/page';

vi.mock('@/lib/api');

const h = vi.hoisted(() => ({
  toastError: vi.fn<(m: string) => void>(),
  toastSuccess: vi.fn<(m: string) => void>(),
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
// Sub-panels have their own data flows; stub them so this file tests the template page itself.
vi.mock('@/app/(dashboard)/content/WhatsAppTestSend', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/CreateWhatsAppTemplate', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/SmsTestSend', () => ({ default: () => null }));
vi.mock('@/app/(dashboard)/content/RcsTestSend', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/content',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type Ret<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
const as = <F extends (...args: never[]) => unknown>(_fn: F, v: unknown): Ret<F> => v as unknown as Ret<F>;
const jsonResponse = (body: unknown): Response => ({ ok: true, json: () => Promise.resolve(body) } as unknown as Response);

const T1 = { id: 1, name: 'Day 1 Welcome', channel: 'email', status: 'approved', subject: 'Welcome!', body: '<p>Hello {{first_name}}</p>' };
const T2 = { id: 20, name: 'WA Promo', channel: 'whatsapp', status: 'draft', body_plain: 'Promo text', cta_text: 'Book now', segment_label: 'VIP' };

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';
const noBadText = () => { expect(bodyText()).not.toContain('NaN'); expect(bodyText()).not.toContain('undefined'); };

function mockTemplates(data: unknown[] = [T1, T2], total = 45) {
  vi.mocked(api.getTemplates).mockResolvedValue(as(api.getTemplates, { data, total }));
}

describe('Content templates page', () => {
  it('renders template cards and the result count from typical data', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(api.getTemplates).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeTruthy();
    expect(screen.getByText('WA Promo')).toBeTruthy();
    expect(bodyText()).toContain('Showing 1–2 of 45 templates');
    expect(screen.getByText('Subject: Welcome!')).toBeTruthy();
    expect(screen.getByText('Hello {{first_name}}')).toBeTruthy();
    expect(screen.getByText('Promo text')).toBeTruthy();
    expect(screen.getByText('CTA: Book now')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(bodyText()).toMatch(/Page\s*1\s*of\s*3/);
    // The active channel tab carries the real total
    expect(within(screen.getByRole('tablist', { name: 'Channel' })).getByRole('tab', { selected: true }).textContent).toBe('All 45');
    noBadText();
  });

  it('renders the "no templates yet" empty state, and the table empty row', async () => {
    mockTemplates([], 0);
    render(<Content />);
    await screen.findByText('No templates yet');
    expect(bodyText()).toContain('Showing 0–0 of 0 templates');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('No templates found')).toBeTruthy();
    noBadText();
  });

  it('shows a filtered empty state when a search matches nothing', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    mockTemplates([], 0);
    fireEvent.change(screen.getByPlaceholderText('Search name or subject…'), { target: { value: 'zzz' } });
    await screen.findByText('No templates found');
    expect(screen.queryByText('No templates yet')).toBeNull();
    noBadText();
  });

  it('shows skeleton cards on first load', async () => {
    vi.mocked(api.getTemplates).mockReturnValue(new Promise(() => {}));
    render(<Content />);
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeTruthy();
    await waitFor(() => expect(api.getTemplates).toHaveBeenCalled());
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeTruthy();
    noBadText();
  });

  it('shows an error state on getTemplates failure and retries', async () => {
    vi.mocked(api.getTemplates).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.authFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Content />);
    await screen.findByText("Couldn't load templates");
    expect(bodyText()).toContain('Showing 0–0 of 0 templates');
    noBadText();
    mockTemplates();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Day 1 Welcome');
    expect(screen.queryByText("Couldn't load templates")).toBeNull();
  });

  it('channel filter, search and pagination send the right query params', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    const channels = screen.getByRole('tablist', { name: 'Channel' });
    fireEvent.click(within(channels).getByRole('tab', { name: 'WhatsApp' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, channel: 'whatsapp' }));
    fireEvent.click(within(channels).getByRole('tab', { name: /^All/ }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    fireEvent.change(screen.getByPlaceholderText('Search name or subject…'), { target: { value: '  promo ' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'promo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 2, limit: 20 }));
    fireEvent.click(screen.getByTitle('Last page'));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 3, limit: 20 }));
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '50' } });
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 50 }));
  });

  it('table view lists templates and persists the view mode', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('Segment')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('content.viewMode')).toBe('table');
    noBadText();
  });

  it('create opens the editor view, validates name and HTML body, then calls createTemplate', async () => {
    mockTemplates();
    vi.mocked(api.createTemplate).mockResolvedValue(as(api.createTemplate, { data: { id: 99, name: 'Summer', channel: 'email', status: 'draft' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'New template' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Message settings' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Preview' })).toBeTruthy();
    expect(screen.queryByText('Day 1 Welcome')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Template name is required');
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Sale Announcement'), { target: { value: '  Summer  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Please upload an HTML file');
    expect(api.createTemplate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/edit directly/), { target: { value: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>' } });
    expect(screen.getByText('{{ITEM_NAME}}')).toBeTruthy();
    expect(bodyText()).toContain('2 placeholders detected');
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledWith({
      name: 'Summer', channel: 'email', subject: null,
      body: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>', bodyPlain: 'Hi {{first_name}} {{ITEM_NAME}}',
      variables: ['first_name', 'ITEM_NAME'],
    }));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template created');
    await screen.findByText('Summer');
    expect(bodyText()).toContain('of 46 templates');
    noBadText();
  });

  it('editor: channel switch hides subject, device toggle, and back returns to the library', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }));
    expect(screen.getByText('0 / 60 characters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    expect(screen.queryByText(/\/ 60 characters/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Nothing to render yet')).toBeTruthy();
    const iframe = screen.getByTitle('template-preview');
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    fireEvent.click(screen.getByRole('button', { name: 'Back to templates' }));
    expect(screen.getByText('Day 1 Welcome')).toBeTruthy();
    noBadText();
  });

  it('shows a toast when saving fails', async () => {
    mockTemplates();
    vi.mocked(api.createTemplate).mockRejectedValue(new Error('Duplicate name'));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }));
    fireEvent.change(await screen.findByPlaceholderText('e.g. Summer Sale Announcement'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText(/edit directly/), { target: { value: '<p>x</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Duplicate name'));
    expect(screen.getByRole('button', { name: 'Create Template' })).toBeTruthy();
  });

  it('edit loads the full template and saves via updateTemplate', async () => {
    mockTemplates();
    vi.mocked(api.getTemplate).mockResolvedValue(as(api.getTemplate, { data: { id: 1, body: '<p>Full {{city}}</p>' } }));
    vi.mocked(api.updateTemplate).mockResolvedValue(as(api.updateTemplate, { data: { ...T1, name: 'Day 1 Updated' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByRole('heading', { level: 1, name: 'Day 1 Welcome' })).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(api.getTemplate).toHaveBeenCalledWith(1);
    await waitFor(() => expect((screen.getByPlaceholderText(/edit directly/) as HTMLTextAreaElement).value).toBe('<p>Full {{city}}</p>'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Day 1 Welcome', subject: 'Welcome!', variables: ['city'] })));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template updated');
    await screen.findByText('Day 1 Updated');
  });

  it('delete asks for confirmation, calls deleteTemplate and updates the count', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByTitle('Delete template')[0]);
    expect(screen.getByRole('alertdialog', { name: 'Delete template' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTitle('Delete template')[0]);
    const buttons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.deleteTemplate).toHaveBeenCalledWith(1));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template deleted');
    await waitFor(() => expect(screen.queryByText('Day 1 Welcome')).toBeNull());
    expect(bodyText()).toContain('of 44 templates');
  });

  it('delete failure shows an error toast and keeps the template', async () => {
    mockTemplates();
    vi.mocked(api.deleteTemplate).mockRejectedValue(new Error('In use by a journey'));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByTitle('Delete template')[0]);
    const buttons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('In use by a journey'));
    expect(screen.getAllByText('Day 1 Welcome').length).toBeGreaterThan(0);
  });

  it('preview calls previewTemplate and renders a sandboxed iframe', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Rendered</p>' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledWith(1));
    const dialog = await screen.findByRole('dialog', { name: 'Preview of Day 1 Welcome' });
    await waitFor(() => expect(dialog.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox'));
    expect(bodyText()).toContain('Email · ALL · Approved');
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    noBadText();
  });

  it('AI preview calls previewTemplateAI for Day 1-7 email templates', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplateAI).mockResolvedValue(as(api.previewTemplateAI, { data: { html: '<p>AI</p>' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(screen.getAllByRole('button', { name: /Preview AI Template/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Preview AI Template/ }));
    await waitFor(() => expect(api.previewTemplateAI).toHaveBeenCalledWith(1));
  });

  it('QA report button shows the "no report yet" message when nothing is stored', async () => {
    mockTemplates();
    vi.mocked(api.getStoredQaReport).mockResolvedValue(as(api.getStoredQaReport, {}));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByTitle('View email QA report')[0]);
    await screen.findByText(/No report yet/);
    expect(api.getStoredQaReport).toHaveBeenCalledWith(1);
  });

  it('renders a stored QA report without NaN/undefined', async () => {
    mockTemplates();
    vi.mocked(api.getStoredQaReport).mockResolvedValue(as(api.getStoredQaReport, { data: {
      subject: 'Welcome!', grammar: ['Typo: recieve'], missingContent: [], errors: [],
      urls: { results: [{ ok: true, status: 200, url: 'https://a.com' }] },
      spamRisk: { level: 'Low' }, placement: { available: true, placement: 'inbox' },
    } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByTitle('View email QA report')[0]);
    await screen.findByText('Typo: recieve');
    expect(screen.getByText('Inbox — not spam')).toBeTruthy();
    expect(bodyText()).toContain('URLs (0 found, 0 broken)');
    expect(screen.getByText('https://a.com')).toBeTruthy();
    noBadText();
  });

  it('approval banner and review panel approve a pending template', async () => {
    const P = { id: 30, name: 'Pending Offer', channel: 'email', status: 'pending_approval', subject: 'Big sale' };
    mockTemplates([T1, P], 2);
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Offer</p>' } }));
    vi.mocked(api.approveTemplate).mockResolvedValue(as(api.approveTemplate, { data: { ...P, status: 'approved' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    expect(bodyText()).toContain('1 template is waiting for approval on this page');
    expect(bodyText()).toContain('“Pending Offer” (Email)');
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }));
    const aside = await screen.findByRole('complementary', { name: 'Pending Offer' });
    expect(aside.textContent).toContain('Approval review · 1 of 1');
    expect(aside.textContent).toContain('Subject: Big sale');
    await waitFor(() => expect(aside.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve template' }));
    await waitFor(() => expect(api.approveTemplate).toHaveBeenCalledWith(30));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template approved');
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(bodyText()).not.toContain('waiting for approval');
    noBadText();
  });

  it('review panel rejects and surfaces errors', async () => {
    const P = { id: 31, name: 'WA Pending', channel: 'whatsapp', status: 'pending_approval', body_plain: 'Hi there' };
    mockTemplates([P], 1);
    vi.mocked(api.rejectTemplate).mockRejectedValueOnce(new Error('Not allowed'));
    render(<Content />);
    await screen.findAllByText('WA Pending');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const aside = await screen.findByRole('complementary', { name: 'WA Pending' });
    expect(aside.textContent).toContain('Hi there');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Not allowed'));
    expect(screen.getByRole('complementary')).toBeTruthy();
    vi.mocked(api.rejectTemplate).mockResolvedValue(as(api.rejectTemplate, {}));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('Template rejected'));
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(api.previewTemplate).not.toHaveBeenCalled();
  });

  it('loads test-send contacts and email tracking-flow stats via authFetch', async () => {
    mockTemplates();
    vi.mocked(api.authFetch).mockImplementation((url: string) => {
      if (url.includes('/test-sends/contacts')) return Promise.resolve(jsonResponse({ data: { contacts: [{ email: 'r@x.com', name: 'Rocky', country: 'UAE' }], total: 1 } }));
      if (url.includes('/send-log/summary')) return Promise.resolve(jsonResponse({ data: { byStatus: [{ status: 'sent', count: '5' }, { status: 'opened', count: '3' }, { status: 'clicked', count: '2' }, { status: 'failed', count: '1' }] } }));
      return Promise.resolve(jsonResponse({ data: { total: 4 } }));
    });
    render(<Content />);
    await screen.findByText('r@x.com');
    expect(bodyText()).toContain('Rocky • UAE');
    await waitFor(() => expect(screen.getByText('UTM Captured').previousElementSibling?.textContent).toBe('4'));
    expect(screen.getByText('Sent').previousElementSibling?.textContent).toBe('10');
    expect(screen.getByText('Opened').previousElementSibling?.textContent).toBe('5');
    expect(screen.getByText('Failed').previousElementSibling?.textContent).toBe('1');
    // Selecting a recipient enables the "selected" test-send button
    expect(screen.getByRole('button', { name: 'Test Send (select recipients)' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(bodyText()).toContain('1 selected of 1');
    expect(screen.getByRole('button', { name: 'Test Send to 1 selected' })).toHaveProperty('disabled', false);
    noBadText();
  });

  it('testing tools tabs switch between the channel sub-panels', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    const tools = screen.getByRole('tablist', { name: 'Testing tools' });
    expect(screen.getByText('Email tracking flow')).toBeTruthy();
    fireEvent.click(within(tools).getByRole('tab', { name: 'SMS' }));
    expect(screen.queryByText('Email tracking flow')).toBeNull();
    expect(within(tools).getByRole('tab', { name: 'SMS' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(tools).getByRole('tab', { name: 'Email' }));
    expect(screen.getByText('Email tracking flow')).toBeTruthy();
  });
});
