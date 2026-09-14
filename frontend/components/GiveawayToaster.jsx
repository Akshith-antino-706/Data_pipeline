'use client';

/**
 * GiveawayToaster — pops a toast for each NEW giveaway event, wherever you are in the dashboard.
 * No nav item, no page: it just surfaces activity as toasts.
 *
 * It watches TWO feeds and toasts both:
 *   • the RabbitMQ consumer  → /giveaways/mq-log   (events captured from CloudAMQP — the real path)
 *   • the BullMQ log         → /giveaways/log      (the HTTP test path, kept for manual triggers)
 *
 * On first load it seeds the backlog silently, so only events that arrive AFTER mount are toasted.
 */
import { useEffect, useRef } from 'react';
import hotToast from 'react-hot-toast';
import { getGiveawayLog, getGiveawayMqLog } from '@/lib/api';

const OUTCOME = {
  received:   { icon: '🎁', bg: '#16a34a', label: 'received' },
  sent:       { icon: '📧', bg: '#16a34a', label: 'sent' },
  duplicate:  { icon: '🔁', bg: '#475569', label: 'duplicate' },
  poison:     { icon: '⛔', bg: '#b45309', label: 'dropped' },
  dropped:    { icon: '⛔', bg: '#b45309', label: 'dropped' },
  failed:     { icon: '❌', bg: '#dc2626', label: 'failed' },
  processing: { icon: '⏳', bg: '#0ea5e9', label: 'processing' },
  queued:     { icon: '📥', bg: '#6366f1', label: 'queued' },
  completed:  { icon: '✅', bg: '#16a34a', label: 'completed' },
};

function toastEvent(e) {
  const status = e.outcome || e.label || 'received';
  const o = OUTCOME[status] || OUTCOME.received;
  const who = `${e.name ? e.name + ' ' : ''}<${e.email || ''}>`;
  const extra = e.detail || e.reason || e.subject || '';
  hotToast(
    `${o.icon}  Giveaway ${e.type || ''} — ${o.label}\n${who}${extra ? `\n${extra}` : ''}`,
    { duration: 5000, style: { whiteSpace: 'pre-line', fontSize: 12.5, background: o.bg, color: '#fff' } }
  );
}

export default function GiveawayToaster({ intervalMs = 5000 }) {
  const seen = useRef(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const [mq, bq] = await Promise.all([
          getGiveawayMqLog(25).catch(() => null),
          getGiveawayLog(25).catch(() => null),
        ]);
        if (!alive) return;

        // Normalise both feeds into one keyed list (mq uses id+ts, bullmq uses jobId).
        const events = [];
        (mq?.events || []).forEach(e => events.push({ ...e, _key: `mq:${e.id}:${e.outcome}:${e.ts || ''}` }));
        (bq?.events || []).forEach(e => events.push({ ...e, _key: `bq:${e.jobId}` }));

        if (!seeded.current) {
          events.forEach(e => seen.current.add(e._key));   // silent backlog seed
          seeded.current = true;
          return;
        }
        // Oldest → newest so multiple new events stack in natural order.
        for (const e of [...events].reverse()) {
          if (!e._key || seen.current.has(e._key)) continue;
          seen.current.add(e._key);
          toastEvent(e);
        }
      } catch { /* ignore transient poll errors */ }
    };

    poll();
    const t = setInterval(poll, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);

  return null;
}
