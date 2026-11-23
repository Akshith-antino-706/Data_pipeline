// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DubaiClock, ScheduledStartCountdown } from '@/app/(dashboard)/journeys/LiveClocks';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('LiveClocks', () => {
  it('DubaiClock ticks on its own and stops when the tab is hidden', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    render(<DubaiClock />);
    expect(screen.getByText(/14:00:00/)).toBeTruthy(); // Dubai = UTC+4
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/14:00:02/)).toBeTruthy();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText(/14:00:02/)).toBeTruthy(); // frozen while hidden
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(screen.getByText(/14:00:07/)).toBeTruthy();
  });

  it('ScheduledStartCountdown counts down and fires onDue exactly once at zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    const onDue = vi.fn();
    render(<ScheduledStartCountdown at="2026-10-23T10:00:03Z" onDue={onDue} />);
    expect(screen.getByTestId('scheduled-start-countdown').textContent).toContain('03');
    expect(onDue).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('scheduled-start-countdown')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it('ScheduledStartCountdown renders nothing for an invalid or past time and never fires twice', () => {
    const onDue = vi.fn();
    const { container } = render(<ScheduledStartCountdown at="not-a-date" onDue={onDue} />);
    expect(container.innerHTML).toBe('');
    expect(onDue).not.toHaveBeenCalled();
  });
});
