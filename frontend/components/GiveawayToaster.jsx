'use client';

/**
 * GiveawayToaster — polls the giveaway email log and pops a toast for each NEW event
 * (consumed message). No nav item, no page: it just surfaces the worker's activity as
 * toasts wherever you are in the dashboard. On first load it seeds the backlog silently,
 * so only events that arrive AFTER mount are toasted.
 */
import { useEffect, useRef } from 'react';
import hotToast from 'react-hot-toast';
import { getGiveawayLog } from '@/lib/api';

const OUTCOME = {
  received:   { icon: '🎁', bg: '#16a34a' },
  duplicate:  { icon: '🔁', bg: '#475569' },
  dropped:    { icon: '⛔', bg: '#b45309' },
  failed:     { icon: '❌', bg: '#dc2626' },
  processing: { icon: '⏳', bg: '#0ea5e9' },
  queued:     { icon: '📥', bg: '#6366f1' },
  completed:  { icon: '✅', bg: '#16a34a' },
};

export default function GiveawayToaster({ intervalMs = 5000 }) {
  const seen = useRef(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await getGiveawayLog(25);
        if (!alive || !r?.ok) return;
        const events = r.events || [];
        if (!seeded.current) {
          events.forEach(e => seen.current.add(e.jobId));   // silent backlog seed
          seeded.current = true;
          return;
        }
        // Oldest → newest so multiple new events stack in natural order.
        for (const e of [...events].reverse()) {
          if (!e.jobId || seen.current.has(e.jobId)) continue;
          seen.current.add(e.jobId);
          const o = OUTCOME[e.label] || OUTCOME.received;
          hotToast(
            `${o.icon}  Giveaway ${e.type || ''} — ${e.label}\n${e.name ? e.name + ' ' : ''}<${e.email || ''}>${e.detail ? `\n${e.detail}` : ''}`,
            { duration: 5000, style: { whiteSpace: 'pre-line', fontSize: 12.5, background: o.bg, color: '#fff' } }
          );
        }
      } catch { /* ignore transient poll errors */ }
    };
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);

  return null;
}
