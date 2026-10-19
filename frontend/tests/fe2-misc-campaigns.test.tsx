// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import Campaigns from '@/app/(dashboard)/campaigns/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/campaigns',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

type ApiName = keyof typeof api;
const asMock = (name: ApiName) => vi.mocked(api[name]) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;
const mockOk = (name: ApiName, v: unknown) => asMock(name).mockResolvedValue(v);

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

describe('Campaigns list page', () => {
  it('shows the loading skeleton while journeys are pending', () => {
    asMock('getJourneys').mockReturnValue(new Promise(() => {}));
    const { container } = render(<Campaigns />);
    expect(screen.getByText('Campaigns')).toBeTruthy();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/All Campaigns/)).toBeNull();
  });

  it('requests up to 100 journeys and renders rows with channel, segment and status', async () => {
    mockOk('getJourneys', { data: [
      { journey_id: 1, name: 'Welcome', segment_name: 'New users', status: 'active', nodes: [{ type: 'trigger' }, { type: 'action', data: { channel: 'Email' } }] },
      { journey_id: 2, name: 'Winback', status: 'weird', nodes: [{ type: 'action', data: { channel: 'carrier-pigeon' } }] },
      { journey_id: 3, name: 'No nodes', status: 'draft' },
    ] });
    render(<Campaigns />);
    await screen.findByText('Welcome');
    expect(api.getJourneys).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getByText('All Campaigns (3)')).toBeTruthy();
    expect(screen.getByText('email')).toBeTruthy();
    expect(screen.getByText('New users')).toBeTruthy();
    expect(screen.getByText('carrier-pigeon')).toBeTruthy();
    expect(screen.getByText('weird').className).toContain('badge-gray');
    expect(screen.getByText('active').className).toContain('badge-green');
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('navigates to the journey detail when a row is clicked', async () => {
    mockOk('getJourneys', { data: [{ journey_id: 77, name: 'Click me', status: 'paused' }] });
    render(<Campaigns />);
    fireEvent.click(await screen.findByText('Click me'));
    expect(nav.push).toHaveBeenCalledWith('/campaigns/77');
  });

  it('shows the empty state for empty / missing data', async () => {
    render(<Campaigns />);
    await screen.findByText('No journeys yet');
    expect(screen.getByText('All Campaigns (0)')).toBeTruthy();
  });

  it('handles API errors without crashing', async () => {
    asMock('getJourneys').mockRejectedValue(new Error('HTTP 500'));
    render(<Campaigns />);
    await screen.findByText('No journeys yet');
    expect(console.error).toHaveBeenCalled();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });
});
