'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * Small self-ticking components. They own their 1-second timers so the big journeys page
 * doesn't re-render every second; they only tick while mounted and while the tab is visible.
 */

function useSecondTick(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!id) id = setInterval(() => setNow(Date.now()), 1000); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const onVis = () => { if (document.visibilityState === 'hidden') stop(); else { setNow(Date.now()); start(); } };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
  return now;
}

/** Current Dubai time, e.g. "23 Oct 2026, 14:05:09". */
export function DubaiClock() {
  const now = useSecondTick();
  return <>{new Date(now).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    day: '2-digit', month: 'short', year: 'numeric',
  })}</>;
}

interface CountdownProps {
  /** ISO start time. */
  at: string;
  /** Called once when the countdown reaches zero. */
  onDue: () => void;
}

/** "Auto-starts in" banner for a scheduled draft journey; fires `onDue` exactly once at zero. */
export function ScheduledStartCountdown({ at, onDue }: CountdownProps) {
  const now = useSecondTick();
  const target = new Date(at).getTime();
  const diff = Number.isFinite(target) ? target - now : NaN;
  const [fired, setFired] = useState(false);
  useEffect(() => {
    if (!fired && Number.isFinite(diff) && diff <= 0) { setFired(true); onDue(); }
  }, [diff, fired, onDue]);
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const total = Math.floor(diff / 1000);
  const parts = [
    { v: Math.floor(total / 86400), l: 'D' },
    { v: Math.floor((total % 86400) / 3600), l: 'H' },
    { v: Math.floor((total % 3600) / 60), l: 'M' },
    { v: total % 60, l: 'S' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '14px 20px', marginBottom: 20, borderRadius: 12,
      background: 'linear-gradient(135deg, rgba(255,153,51,0.08) 0%, rgba(234,179,8,0.08) 100%)',
      border: '1px solid rgba(255,153,51,0.35)',
    }} data-testid="scheduled-start-countdown">
      <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
        <Clock size={16} color="var(--orange)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>Auto-starts in</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ({new Date(at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} Dubai)
        </span>
      </div>
      <div className="flex items-center gap-2">
        {parts.map(({ v, l }) => (
          <div key={l} style={{ textAlign: 'center', minWidth: 44 }}>
            <div style={{
              fontSize: 22, fontWeight: 800, color: 'var(--orange)',
              background: 'var(--orange-dim)', borderRadius: 8,
              padding: '4px 8px', lineHeight: 1, border: '1px solid rgba(255,153,51,0.3)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {String(v).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.5px' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ticking "now" for wait-node countdowns; only ticks while `enabled` (an active journey with wait nodes). */
export function useLiveNow(enabled: boolean): number {
  return useSecondTick(enabled);
}
