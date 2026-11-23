import { Chip, type ChipTone } from './Chip';

const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  ON_TRIP: { label: 'On trip', tone: 'gold' },
  FUTURE_TRAVEL: { label: 'Upcoming trip', tone: 'info' },
  ACTIVE_ENQUIRY: { label: 'Active enquiry', tone: 'warn' },
  PAST_BOOKING: { label: 'Past booker', tone: 'mute' },
  PAST_ENQUIRY: { label: 'Past enquiry', tone: 'mute' },
  PROSPECT: { label: 'Prospect', tone: 'mute' },
};

/** Human label + tone for a unified_contacts.booking_status value. Unknown values are title-cased. */
export function contactStatusInfo(status?: string | null): { label: string; tone: ChipTone } {
  const key = (status || 'PROSPECT').toUpperCase();
  if (STATUS[key]) return STATUS[key];
  const label = key.toLowerCase().split('_').filter(Boolean).join(' ');
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: 'mute' };
}

export interface ContactStatusChipProps {
  status?: string | null;
  /** Extra text after the label, e.g. a travel date. */
  suffix?: string;
}

export function ContactStatusChip({ status, suffix }: ContactStatusChipProps) {
  const { label, tone } = contactStatusInfo(status);
  return <Chip tone={tone} title={status || 'PROSPECT'}>{suffix ? `${label} · ${suffix}` : label}</Chip>;
}
