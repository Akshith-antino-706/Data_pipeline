// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import AllSegmentsPage from '@/app/(dashboard)/segmentation/all-segments/page';

vi.mock('@/lib/api');

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.push, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/segmentation/all-segments',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn<(m: string) => void>(), error: vi.fn<(m: string) => void>() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

const segs = [
  { id: 1, name: 'High Spenders', description: 'Big wallets', status: 'active', color: '#ff0000', cached_count: 1234,
    conditions: [{ field: 'total_revenue' }, { field: 'country' }, { field: 'booking_status' }, { field: 'product_tier' }, { field: 'geo' }],
    created_at: '2026-10-01T00:00:00Z' },
  { id: 2, name: 'Draft Seg', description: null, status: 'draft', color: null, cached_count: null, conditions: [], created_at: '2026-09-01T00:00:00Z' },
];
type SegRes = Awaited<ReturnType<typeof api.getCustomSegments>>;

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({});
  }
  nav.push.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>CRASHED</p> : this.props.children; }
}

const bodyText = (): string => document.body.textContent ?? '';

describe('All segments page', () => {
  it('renders segments with counts, tabs and condition tags', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    expect(screen.getByText('2 segments')).toBeTruthy();
    expect(screen.getByText('All (2)')).toBeTruthy();
    expect(screen.getByText('Active (1)')).toBeTruthy();
    expect(screen.getByText('Draft (1)')).toBeTruthy();
    expect(screen.getByText((1234).toLocaleString())).toBeTruthy();
    expect(screen.getByText('total revenue')).toBeTruthy();
    expect(screen.getByText('+2 more')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(api.getCustomSegments).toHaveBeenCalledWith({});
  });

  it('shows loading state first', () => {
    vi.mocked(api.getCustomSegments).mockReturnValue(new Promise(() => {}));
    render(<AllSegmentsPage />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('empty data shows empty-state', async () => {
    render(<AllSegmentsPage />);
    await screen.findByText('No custom segments yet');
    expect(screen.getByText('0 segments')).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it('API error toasts and does not crash', async () => {
    vi.mocked(api.getCustomSegments).mockRejectedValue(new Error('HTTP 500'));
    render(<AllSegmentsPage />);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to load segments'));
    expect(screen.getByText('No custom segments yet')).toBeTruthy();
  });

  it('status tab refetches with status param', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    fireEvent.click(screen.getByText('Draft (1)'));
    await waitFor(() => expect(api.getCustomSegments).toHaveBeenCalledWith({ status: 'draft' }));
  });

  it('search filters by name/description and shows no-match message', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    const input = screen.getByPlaceholderText('Search segments...');
    fireEvent.change(input, { target: { value: 'wallets' } });
    expect(screen.getByText('High Spenders')).toBeTruthy();
    expect(screen.queryByText('Draft Seg')).toBeNull();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No segments match your search')).toBeTruthy();
  });

  it('card click navigates to custom segment detail', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    fireEvent.click(await screen.findByText('Draft Seg'));
    expect(nav.push).toHaveBeenCalledWith('/segmentation/custom/2');
  });

  it('toggle status calls updateCustomSegment with flipped status', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    fireEvent.click(screen.getByTitle('Set to Draft'));
    await waitFor(() => expect(api.updateCustomSegment).toHaveBeenCalledWith(1, { status: 'draft' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Segment set to draft'));
    fireEvent.click(screen.getByTitle('Activate'));
    await waitFor(() => expect(api.updateCustomSegment).toHaveBeenCalledWith(2, { status: 'active' }));
  });

  it('toggle failure toasts an error', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    vi.mocked(api.updateCustomSegment).mockRejectedValue(new Error('x'));
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    fireEvent.click(screen.getByTitle('Activate'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to update status'));
  });

  it('delete asks for confirmation; cancel does nothing, confirm deletes', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(screen.getByText('Delete Segment')).toBeTruthy();
    expect(screen.getByText(/5 conditions/)).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(api.deleteCustomSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTitle('Delete')[1]);
    expect(screen.getByText(/0 conditions/)).toBeTruthy();
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(api.deleteCustomSegment).toHaveBeenCalledWith(2));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Segment deleted'));
  });

  it('delete failure toasts error', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: segs } as unknown as SegRes);
    vi.mocked(api.deleteCustomSegment).mockRejectedValue(new Error('x'));
    render(<AllSegmentsPage />);
    await screen.findByText('High Spenders');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Failed to delete segment'));
  });

  it('Create Segment opens the modal', async () => {
    render(<AllSegmentsPage />);
    await screen.findByText('No custom segments yet');
    fireEvent.click(screen.getAllByText('Create Segment')[0]);
    await screen.findByText('Create Custom Segment');
  });

  // BUG: all-segments/page.tsx:50 calls s.name.toLowerCase() unguarded, so a segment
  // whose name is null (legacy/bad row) crashes the whole page.
  it('a segment with a null name does not crash the page', async () => {
    vi.mocked(api.getCustomSegments).mockResolvedValue({ data: [{ ...segs[0], name: null }, segs[1]] } as unknown as SegRes);
    render(<Boundary><AllSegmentsPage /></Boundary>);
    await waitFor(() => expect(api.getCustomSegments).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('CRASHED')).toBeNull();
    expect(screen.getByText('Draft Seg')).toBeTruthy();
  });
});
