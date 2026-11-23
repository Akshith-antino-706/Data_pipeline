// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as api from '@/lib/api';
import SystemArchitecture from '@/app/(dashboard)/system/page';

vi.mock('@/lib/api');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn(() => Promise.reject(new Error('network disabled in tests')));
beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const bodyText = (): string => document.body.textContent ?? '';

// Static documentation page: no data loading, so "empty / error / loading" states don't apply.
describe('System architecture page', () => {
  it('renders the header and all 16 sections, only section 1 open by default', () => {
    render(<SystemArchitecture />);
    expect(screen.getByText('System Architecture & Documentation')).toBeTruthy();
    expect(screen.getByText(/^1\. System Overview/)).toBeTruthy();
    expect(screen.getByText(/^16\. Troubleshooting/)).toBeTruthy();
    expect(screen.getByText(/omnichannel marketing automation platform/)).toBeTruthy();
    expect(screen.queryByText(/incremental by timestamp/)).toBeNull();
  });

  it('toggles a section open and closed on header click', () => {
    render(<SystemArchitecture />);
    const header = screen.getByText(/^2\. Data Sources/);
    fireEvent.click(header);
    expect(screen.getByText(/incremental by timestamp/)).toBeTruthy();
    fireEvent.click(header);
    expect(screen.queryByText(/incremental by timestamp/)).toBeNull();
  });

  it('collapses the default-open section', () => {
    render(<SystemArchitecture />);
    fireEvent.click(screen.getByText(/^1\. System Overview/));
    expect(screen.queryByText(/omnichannel marketing automation platform/)).toBeNull();
  });

  it('opens every section without NaN/undefined and without any API or network call', () => {
    render(<SystemArchitecture />);
    for (let i = 2; i <= 16; i++) fireEvent.click(screen.getByText(new RegExp(`^${i}\\. `)));
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const fn of Object.values(api)) {
      if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
  });
});
