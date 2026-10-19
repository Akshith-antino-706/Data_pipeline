// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import type { AuthContextValue } from '@/context/AuthContext';
import LoginPage from '@/app/(public)/login/page';
import LandingRedirect from '@/app/(public)/landing/page';
import LeadsAccessPage from '@/app/(public)/leads-access/page';
import HomePage from '@/app/page';

vi.mock('@/lib/api');

const h = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
  redirect: vi.fn<(href: string) => void>(),
  login: vi.fn<(email: string, password: string) => Promise<void>>(),
  isAuthenticated: false,
  toastError: vi.fn<(msg: string) => void>(),
  toastSuccess: vi.fn<(msg: string) => void>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.replace, replace: h.replace, back: () => {}, prefetch: () => {}, refresh: h.refresh }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: (href: string) => h.redirect(href),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: h.isAuthenticated, login: h.login } as unknown as AuthContextValue),
}));

class FakeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  h.isAuthenticated = false;
  h.replace.mockReset(); h.refresh.mockReset(); h.redirect.mockReset();
  h.login.mockReset(); h.toastError.mockReset(); h.toastSuccess.mockReset();
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

const bodyText = (): string => document.body.textContent ?? '';
const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);

describe('Login page', () => {
  it('renders the form with no NaN/undefined', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('renders nothing and redirects when already authenticated', async () => {
    h.isAuthenticated = true;
    const { container } = render(<LoginPage />);
    expect(container.innerHTML).toBe('');
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('validates empty fields without calling login', () => {
    render(<LoginPage />);
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement);
    expect(h.toastError).toHaveBeenCalledWith('Please enter both email and password');
    expect(h.login).not.toHaveBeenCalled();
  });

  it('logs in with entered credentials, shows loading, then redirects', async () => {
    let resolve: () => void = () => {};
    h.login.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Signing in...');
    expect(h.login).toHaveBeenCalledWith('a@b.com', 'secret');
    resolve();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'));
    expect(h.toastSuccess).toHaveBeenCalledWith('Welcome back!');
  });

  it('shows error toast on login failure and re-enables the button', async () => {
    h.login.mockRejectedValue(new Error('Invalid credentials'));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Invalid credentials'));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('falls back to a generic message when the error has none', async () => {
    h.login.mockRejectedValue(new Error(''));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Login failed. Please try again.'));
  });

  it('toggles password visibility', () => {
    render(<LoginPage />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(pw.type).toBe('text');
    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(pw.type).toBe('password');
  });
});

describe('Landing redirect page', () => {
  it('redirects to /', () => {
    LandingRedirect();
    expect(h.redirect).toHaveBeenCalledWith('/');
  });
});

describe('Leads access page', () => {
  const submit = (): void => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); };

  it('renders with no NaN/undefined', () => {
    render(<LeadsAccessPage />);
    expect(screen.getByText('Protected Leads')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('validates an empty / whitespace token without fetching', () => {
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: '   ' } });
    submit();
    expect(screen.getByRole('alert').textContent).toBe('Enter the access token to continue.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the token, shows loading, and redirects to /leads', async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>(r => { resolve = r; }));
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'tok' } });
    submit();
    await screen.findByText('Checking…');
    expect(fetchMock).toHaveBeenCalledWith('/leads-access/verify', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok' }) }));
    resolve(jsonResponse(200, {}));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/leads'));
    expect(h.refresh).toHaveBeenCalled();
  });

  it('honours a safe ?next=/leads?x=1 and rejects an open redirect', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    window.history.replaceState(null, '', '/leads-access?next=%2Fleads%3Fx%3D1');
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'tok' } });
    submit();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/leads?x=1'));
    cleanup();
    h.replace.mockReset();
    window.history.replaceState(null, '', '/leads-access?next=https%3A%2F%2Fevil.com');
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'tok' } });
    submit();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/leads'));
  });

  it('shows the server error on 401 and the fallback when none is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid token' }));
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'bad' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid token');
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Access denied'));
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('handles a network failure without crashing', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LeadsAccessPage />);
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'tok' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
  });

  it('toggles token visibility', () => {
    render(<LeadsAccessPage />);
    const input = screen.getByLabelText('Access token') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByLabelText('Show token'));
    expect(input.type).toBe('text');
  });
});

describe('Home (landing) page', () => {
  it('renders marketing content and sign-in links', () => {
    render(<HomePage />);
    expect(screen.getByText('Everything You Need')).toBeTruthy();
    expect(screen.getByText('Smart Segmentation')).toBeTruthy();
    expect(screen.getAllByRole('link').some(a => a.getAttribute('href') === '/login')).toBe(true);
    expect(bodyText()).toContain(String(new Date().getFullYear()));
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('renders nothing and redirects to /dashboard when authenticated', async () => {
    h.isAuthenticated = true;
    const { container } = render(<HomePage />);
    expect(container.innerHTML).toBe('');
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'));
  });
});
