import { Chip, type ChipTone } from './Chip';

export interface SegmentStatusMeta {
  label: string;
  tone: ChipTone;
  /** Token colour for bars and dots. */
  color: string;
}

/** Booking-status display names and token colours shared by the Segments screens. */
export const SEGMENT_STATUS: Record<string, SegmentStatusMeta> = {
  ON_TRIP:        { label: 'On Trip',        tone: 'gold', color: 'var(--gold)' },
  FUTURE_TRAVEL:  { label: 'Future Travel',  tone: 'info', color: 'var(--info)' },
  ACTIVE_ENQUIRY: { label: 'Active Enquiry', tone: 'warn', color: 'var(--warn)' },
  PAST_BOOKING:   { label: 'Past Booking',   tone: 'ok',   color: 'var(--ok)' },
  PAST_ENQUIRY:   { label: 'Past Enquiry',   tone: 'mute', color: 'var(--ink2)' },
  CANCELLED:      { label: 'Cancelled',      tone: 'bad',  color: 'var(--bad)' },
  PROSPECT:       { label: 'Prospect',       tone: 'mute', color: 'var(--ink3)' },
};

export function segmentStatusMeta(code: string | null | undefined): SegmentStatusMeta {
  if (!code) return { label: '—', tone: 'mute', color: 'var(--ink3)' };
  return SEGMENT_STATUS[code] ?? { label: code, tone: 'mute', color: 'var(--ink3)' };
}

export function SegmentStatusChip({ status }: { status: string }) {
  const m = segmentStatusMeta(status);
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

export const tierLabel = (t: string | null | undefined) => (t === 'LUXURY' ? 'Luxury' : t === 'STANDARD' ? 'Standard' : (t ?? ''));
export const geoLabel = (g: string | null | undefined) => (g === 'LOCAL' ? 'Local' : g === 'INTERNATIONAL' ? 'International' : (g ?? ''));
