// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import AllSegmentsRedirect from '@/app/(dashboard)/segmentation/all-segments/page';

const nav = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, back: () => {}, prefetch: () => {}, refresh: () => {} }),
  usePathname: () => '/segmentation/all-segments',
}));
afterEach(() => cleanup());

// The All segments page was merged into /segmentation (search, status filter, paging, edit,
// activate and delete all live there now). The old route only redirects.
describe('All segments route', () => {
  it('redirects to /segmentation and renders nothing', async () => {
    const { container } = render(<AllSegmentsRedirect />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/segmentation'));
    expect(container.innerHTML).toBe('');
  });
});
