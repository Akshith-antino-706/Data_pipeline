import type { ReactNode } from 'react';
import s from './Segment.module.css';

export interface SegmentBarRow {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  value: number;
  /** Right-hand figures (count, share, revenue). */
  figures: ReactNode;
  color: string;
  selected?: boolean;
  onSelect?: () => void;
  /** Extra control at the end of the row (e.g. a details button). */
  action?: ReactNode;
}

/** Horizontal bars drawn to scale against the largest row. */
export function SegmentBars({ rows, label }: { rows: SegmentBarRow[]; label: string }) {
  const max = rows.reduce((m, r) => Math.max(m, Number.isFinite(r.value) ? r.value : 0), 0);
  return (
    <ul className={s.bars} aria-label={label} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map(r => {
        const w = max > 0 && Number.isFinite(r.value) ? Math.max(0, (r.value / max) * 100) : 0;
        return (
          <li key={r.key} className={s.barRow} data-selected={r.selected ? 'true' : undefined}>
            <button type="button" className={s.barLabel} onClick={r.onSelect} disabled={!r.onSelect} aria-pressed={r.onSelect ? !!r.selected : undefined}>
              <span className={s.barName}>{r.label}</span>
              {r.sub && <span className={s.help}>{r.sub}</span>}
            </button>
            <span className={s.barTrack} aria-hidden="true"><span className={s.barFill} style={{ width: `${w}%`, background: r.color }} /></span>
            <span className={s.barValue}>{r.figures}</span>
            <span className={s.barAction}>{r.action}</span>
          </li>
        );
      })}
    </ul>
  );
}
