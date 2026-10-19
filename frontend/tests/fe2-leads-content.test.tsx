// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('WA Promo')).toBeTruthy();
    expect(bodyText()).toContain('Showing 1–2 of 45 templates');
    expect(screen.getByText('Subject: Welcome!')).toBeTruthy();
    expect(screen.getByText('Hello {{first_name}}')).toBeTruthy();
    expect(screen.getByText('Promo text')).toBeTruthy();
    expect(screen.getByText('CTA: Book now')).toBeTruthy();
    expect(bodyText()).toMatch(/Page\s*1\s*of\s*3/);
    noBadText();
  });

  it('renders the empty list (card and table view) without NaN/undefined', async () => {
    mockTemplates([], 0);
    render(<Content />);
    await waitFor(() => expect(bodyText()).toContain('Showing 0–0 of 0 templates'));
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('No templates found')).toBeTruthy();
    noBadText();
  });

  it('shows the full-page loader on first load', async () => {
    vi.mocked(api.getTemplates).mockReturnValue(new Promise(() => {}));
    render(<Content />);
    expect(screen.getByText('Loading templates...')).toBeTruthy();
    await waitFor(() => expect(api.getTemplates).toHaveBeenCalled());
    expect(screen.getByText('Loading templates...')).toBeTruthy();
  });

  it('survives a getTemplates error and a broken tracking endpoint', async () => {
    vi.mocked(api.getTemplates).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(api.authFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Content />);
    await screen.findByText('Content Templates');
    expect(bodyText()).toContain('Showing 0–0 of 0 templates');
    noBadText();
  });

  it('channel filter, search and pagination send the right query params', async () => {
    mockTemplates();
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(api.getTemplates).toHaveBeenLastCalledWith({ page: 1, limit: 20, channel: 'whatsapp' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
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
    expect(localStorage.getItem('content.viewMode')).toBe('table');
    noBadText();
  });

  it('create form validates name and HTML body, then calls createTemplate with the payload', async () => {
    mockTemplates();
    vi.mocked(api.createTemplate).mockResolvedValue(as(api.createTemplate, { data: { id: 99, name: 'Summer', channel: 'email', status: 'draft' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Add Template/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Template name is required');
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Sale Announcement'), { target: { value: '  Summer  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    expect(h.toastError).toHaveBeenLastCalledWith('Please upload an HTML file');
    expect(api.createTemplate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/edit directly/), { target: { value: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledWith({
      name: 'Summer', channel: 'email', subject: null,
      body: '<h1>Hi {{first_name}}</h1><p>{{ITEM_NAME}}</p>', bodyPlain: 'Hi {{first_name}} {{ITEM_NAME}}',
      variables: ['first_name', 'ITEM_NAME'],
    }));
    expect(h.toastSuccess).toHaveBeenCalledWith('Template created');
    await screen.findByText('Summer');
    expect(bodyText()).toContain('of 46 templates');
  });

  it('shows a toast when saving fails', async () => {
    mockTemplates();
    vi.mocked(api.createTemplate).mockRejectedValue(new Error('Duplicate name'));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getByRole('button', { name: /Add Template/ }));
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
    await screen.findByText('Edit Template');
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
    expect(screen.getByText('Delete Template')).toBeTruthy();
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

  it('preview calls previewTemplate with the template id', async () => {
    mockTemplates();
    vi.mocked(api.previewTemplate).mockResolvedValue(as(api.previewTemplate, { data: { html: '<p>Rendered</p>' } }));
    render(<Content />);
    await screen.findByText('Day 1 Welcome');
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalledWith(1));
    noBadText();
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
    noBadText();
  });
});
