'use client';

import { useMemo, useState } from 'react';
import styles from './ContactSourcesCard.module.css';

// "Contacts by source" card. The API returns one row per source COMBINATION
// (e.g. "agent,phpadmin"). Two views over that same real data:
//  - By source: each contact counted once per source it came from (combinations split),
//    so the rows add up to more than the total.
//  - Combinations: the raw rows, with readable names.
export interface SourceRow { source: string; count: number }
interface Props {
  total: number;
  sources: SourceRow[];
  rangeText: string;
  fmt: (v: number) => string;
}

const NAMES: Record<string, string> = {
  phpadmin: 'PHP Admin', tours: 'Tours', chats: 'Chats', visas: 'Visas', guestuser: 'Guest users',
  agent: 'Agents', packages: 'Packages', hotels: 'Hotels', flights: 'Flights', cruises: 'Cruises',
  booking: 'Bookings', website: 'Website', whatsapp: 'WhatsApp', chat: 'Chats', giveaway: 'Giveaways',
  registration: 'Registrations', affiliate: 'Affiliates', gtm: 'Website (GTM)',
};
const PALETTE = ['var(--gold)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--gold-ink)', 'var(--bad)', 'var(--ink2)'];
const TOP = 8;

const nameOf = (raw: string) => {
  const k = raw.trim().toLowerCase();
  return NAMES[k] ?? (k ? k.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown');
};
const parts = (raw: string) => raw.split(',').map(s => s.trim()).filter(Boolean);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export default function ContactSourcesCard({ total, sources, rangeText, fmt }: Props) {
  const [view, setView] = useState<'single' | 'combo'>('single');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    if (view === 'combo') {
      return sources
        .map(s => ({ key: s.source, label: parts(s.source).map(nameOf).join(' + ') || 'Unknown', count: num(s.count) }))
        .sort((a, b) => b.count - a.count);
    }
    const m = new Map<string, number>();
    for (const s of sources) for (const p of (parts(s.source).length ? parts(s.source) : ['unknown'])) {
      const k = p.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + num(s.count));
    }
    return [...m.entries()].map(([k, c]) => ({ key: k, label: nameOf(k), count: c })).sort((a, b) => b.count - a.count);
  }, [sources, view]);

  const max = rows[0]?.count ?? 0;
  const safeTotal = num(total);
  const shown = showAll ? rows : rows.slice(0, TOP);
  const singleCount = useMemo(() => new Set(sources.flatMap(s => parts(s.source).map(p => p.toLowerCase()))).size, [sources]);

  return (
    <div>
      <div className={styles.summary}>
        <div>
          <span className={styles.total}>{fmt(safeTotal)}</span>
          <span className={styles.sub}>{rangeText} · {sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.seg} role="group" aria-label="Group by">
          <button type="button" aria-pressed={view === 'single'} className={view === 'single' ? styles.on : ''} onClick={() => { setView('single'); setShowAll(false); }}>
            By source <span className={styles.badge}>{singleCount}</span>
          </button>
          <button type="button" aria-pressed={view === 'combo'} className={view === 'combo' ? styles.on : ''} onClick={() => { setView('combo'); setShowAll(false); }}>
            Combinations <span className={styles.badge}>{sources.length}</span>
          </button>
        </div>
      </div>

      {view === 'single' && rows.length > 0 && (
        <p className={styles.note}>A contact found in more than one source is counted in each, so these add up to more than the total.</p>
      )}

      <ul className={styles.list} aria-label={view === 'single' ? 'Contacts by source' : 'Contacts by source combination'}>
        {shown.map((r, i) => {
          const width = max > 0 ? Math.max(1.5, (r.count / max) * 100) : 0;
          const share = safeTotal > 0 ? (r.count / safeTotal) * 100 : 0;
          const color = PALETTE[i % PALETTE.length];
          return (
            <li key={r.key} className={styles.row} title={r.key}>
              <span className={styles.label}><span className={styles.dot} style={{ background: color }} aria-hidden="true" />{r.label}</span>
              <span className={styles.track} aria-hidden="true"><span className={styles.bar} style={{ width: `${width}%`, background: color }} /></span>
              <span className={styles.count}>{fmt(r.count)}</span>
              <span className={styles.share}>{share > 0 && share < 0.1 ? '<0.1%' : `${share.toFixed(1)}%`}</span>
            </li>
          );
        })}
      </ul>

      {rows.length > TOP && (
        <button type="button" className={styles.more} onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? 'Show top 8' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
