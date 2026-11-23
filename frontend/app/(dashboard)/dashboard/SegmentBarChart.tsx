'use client';

import Link from 'next/link';
import styles from './SegmentBarChart.module.css';

// Segment Distribution as a ranked horizontal bar list. Counts differ by orders of magnitude
// (e.g. Prospect ≈ 1M vs On Trip ≈ a few hundred), so every bar gets a minimum visible width
// and each row shows the exact count and its share of the total.
interface SegmentBarDatum { name: string; customers: number; color: string }
interface SegmentBarChartProps { data: SegmentBarDatum[]; fmt: (v: number) => string }

const MIN_PCT = 1.5;

export default function SegmentBarChart({ data, fmt }: SegmentBarChartProps) {
  const rows = data
    .map(d => ({ ...d, customers: Number.isFinite(d.customers) ? d.customers : 0 }))
    .sort((a, b) => b.customers - a.customers);
  const total = rows.reduce((s, d) => s + d.customers, 0);
  const max = rows.length ? rows[0].customers : 0;

  return (
    <ul className={styles.list} aria-label="Contacts by booking status">
      {rows.map(d => {
        const width = max > 0 ? Math.max(MIN_PCT, (d.customers / max) * 100) : 0;
        const share = total > 0 ? (d.customers / total) * 100 : 0;
        return (
          <li key={d.name}>
            <Link href="/segmentation" className={styles.row}>
              <span className={styles.label}>
                <span className={styles.dot} style={{ background: d.color }} aria-hidden="true" />
                {d.name}
              </span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.bar} style={{ width: `${width}%`, background: d.color }} />
              </span>
              <span className={styles.count}>{fmt(d.customers)}</span>
              <span className={styles.share}>{share < 0.1 && d.customers > 0 ? '<0.1%' : `${share.toFixed(1)}%`}</span>
            </Link>
          </li>
        );
      })}
      <li className={styles.total}>
        <span>Total</span>
        <span className={styles.count}>{fmt(total)}</span>
      </li>
    </ul>
  );
}
