// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import SendWizardPage from '@/app/(dashboard)/sends/new/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/sends/new',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
const authUser = { current: { id: 1, email: 'me@raynatours.com', name: 'Me', role: 'admin' } as { id: number; email: string; name: string | null; role: string } | null };
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current, token: 't', isAuthenticated: true, login: async () => {}, logout: () => {} }),
}));

const SEGMENTS = [
  { segment_id: 7, segment_name: 'Upcoming trip B2C', customer_count: 12014, stage_name: 'Booked', stage_color: '#000' },
  { segment_id: 8, segment_name: 'Lapsed', customer_count: '42', stage_name: 'Retention', stage_color: '#000' },
  { segment_id: 9, segment_name: 'No count', customer_count: null, stage_name: '', stage_color: '#000' },
];
const TEMPLATES = {
  success: true,
  data: [
    { id: 31, name: 'Dubai trip reminder', channel: 'email', status: 'approved', subject: 'Your Dubai trip', approved_at: '2026-10-01T10:00:00Z' },
    { id: 32, name: 'Draft one', channel: 'email', status: 'draft', subject: 'x' },
    { id: 33, name: 'WA one', channel: 'whatsapp', status: 'approved', subject: '' },
  ],
  total: 3,
};

beforeEach(() => {
  authUser.current = { id: 1, email: 'me@raynatours.com', name: 'Me', role: 'admin' };
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.mocked(api.getSegments).mockResolvedValue(SEGMENTS);
  vi.mocked(api.getTemplates).mockResolvedValue(TEMPLATES);
  vi.mocked(api.previewTemplate).mockResolvedValue({ success: true, data: { html: '<p>Hello</p>', subject: 'Your Dubai trip is close' } });
  vi.mocked(api.sendTemplate).mockResolvedValue({ success: true });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('real network not allowed'))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const text = (): string => document.body.textContent ?? '';
const noJunk = (): void => { expect(text()).not.toMatch(/NaN|undefined|Invalid Date|\[object Object\]/); };
const next = (): HTMLButtonElement => screen.getByRole('button', { name: /^Next:/ });

async function toReview(): Promise<void> {
  render(<SendWizardPage />);
  fireEvent.click(await screen.findByRole('radio', { name: /Upcoming trip B2C/ }));
  fireEvent.click(next());
  fireEvent.click(await screen.findByRole('radio', { name: /Dubai trip reminder/ }));
  fireEvent.click(next());
  await screen.findByTitle('Email preview');
  fireEvent.click(next());
}

describe('Send a message wizard', () => {
  it('shows real segments with counts and blocks Next until one is chosen', async () => {
    render(<SendWizardPage />);
    expect(await screen.findByText('Upcoming trip B2C')).toBeTruthy();
    expect(text()).toContain('Booked · 12,014 contacts');
    expect(text()).toContain('Retention · 42 contacts');
    expect(text()).toContain('Unknown contacts');
    expect(next().disabled).toBe(true);
    expect(text()).toContain('Choose a segment to continue');
    fireEvent.click(screen.getByRole('radio', { name: /Lapsed/ }));
    expect(next().disabled).toBe(false);
    noJunk();
  });

  it('lists only approved email templates, asked for with the right filter', async () => {
    render(<SendWizardPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Upcoming trip B2C/ }));
    fireEvent.click(next());
    expect(await screen.findByText('Dubai trip reminder')).toBeTruthy();
    expect(screen.queryByText('Draft one')).toBeNull();
    expect(screen.queryByText('WA one')).toBeNull();
    expect(api.getTemplates).toHaveBeenCalledWith({ status: 'approved', channel: 'email', limit: 200 });
    expect(next().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Dubai trip reminder/ }));
    expect(next().disabled).toBe(false);
    noJunk();
  });

  it('previews via the server and sends a test only to me', async () => {
    render(<SendWizardPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Upcoming trip B2C/ }));
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole('radio', { name: /Dubai trip reminder/ }));
    fireEvent.click(next());
    const frame = await screen.findByTitle('Email preview');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Hello</p>');
    expect(api.previewTemplate).toHaveBeenCalledWith(31);
    expect(text()).toContain('Your Dubai trip is close');
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test sent to me@raynatours.com')).toBeTruthy();
    expect(api.sendTemplate).toHaveBeenCalledTimes(1);
    expect(api.sendTemplate).toHaveBeenCalledWith(31, ['me@raynatours.com']);
    noJunk();
  });

  it('review shows who/what/when and the final send stays disabled (not connected)', async () => {
    await toReview();
    expect(await screen.findByText('Check and send')).toBeTruthy();
    expect(text()).toContain('12,014 contacts in the segment');
    expect(text()).toContain('Email · Dubai trip reminder');
    const send = screen.getByRole('button', { name: /Send to 12,014 contacts/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain("Sending from here isn't connected yet");
    fireEvent.click(send);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(api.executeCampaign).not.toHaveBeenCalled();
    expect(api.processQueue).not.toHaveBeenCalled();
    noJunk();
  });

  it('Back returns to earlier steps keeping choices', async () => {
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByTitle('Email preview')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('radio', { name: /Dubai trip reminder/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows errors for segments, templates, preview and test send', async () => {
    vi.mocked(api.getSegments).mockRejectedValueOnce(new Error('segments down'));
    render(<SendWizardPage />);
    expect(await screen.findByText("Couldn't load segments")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Upcoming trip B2C/ }));
    cleanup();

    vi.mocked(api.getTemplates).mockRejectedValueOnce(new Error('templates down'));
    vi.mocked(api.previewTemplate).mockRejectedValueOnce(new Error('preview down'));
    vi.mocked(api.sendTemplate).mockResolvedValueOnce({ success: false, error: 'No valid recipients found' });
    render(<SendWizardPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Upcoming trip B2C/ }));
    fireEvent.click(next());
    expect(await screen.findByText("Couldn't load templates")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Dubai trip reminder/ }));
    fireEvent.click(next());
    expect(await screen.findByText("Couldn't load the preview")).toBeTruthy();
    expect(next().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText(/Test failed: No valid recipients found/)).toBeTruthy();
    noJunk();
  });

  it('handles empty lists and a user with no email', async () => {
    authUser.current = null;
    vi.mocked(api.getSegments).mockResolvedValue([]);
    render(<SendWizardPage />);
    expect(await screen.findByText('No segments yet')).toBeTruthy();
    noJunk();
  });
});
