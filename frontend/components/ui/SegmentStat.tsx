import type { ReactNode } from 'react';
import s from './Segment.module.css';

export interface SegmentStatProps {
  label: ReactNode;
  value: ReactNode;
  help?: ReactNode;
  color?: string;
}

/** KPI tile used across the Segments screens. */
export function SegmentStat({ label, value, help, color }: SegmentStatProps) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue} style={color ? { color } : undefined}>{value}</span>
      {help && <span className={s.help}>{help}</span>}
    </div>
  );
}
