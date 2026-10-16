export type BookingStatus = 'ON_TRIP' | 'FUTURE_TRAVEL' | 'ACTIVE_ENQUIRY' | 'PAST_BOOKING' | 'PAST_ENQUIRY' | 'PROSPECT';
export type ProductTier = 'LUXURY' | 'STANDARD';
export type Geography = 'LOCAL' | 'INTERNATIONAL';

export interface SegmentCombo {
  bookingStatus: BookingStatus | null;
  productTier: ProductTier | null;
  geography: Geography | null;
}

const STATUS_MAP: Record<string, BookingStatus> = {
  'on-trip': 'ON_TRIP',
  'future-travel': 'FUTURE_TRAVEL',
  'active-enquiry': 'ACTIVE_ENQUIRY',
  'past-booking': 'PAST_BOOKING',
  'past-enquiry': 'PAST_ENQUIRY',
  'prospect': 'PROSPECT',
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  ON_TRIP: 'On Trip',
  FUTURE_TRAVEL: 'Future Travel',
  ACTIVE_ENQUIRY: 'Active Enquiry',
  PAST_BOOKING: 'Past Booking',
  PAST_ENQUIRY: 'Past Enquiry',
  PROSPECT: 'Prospect',
};

export function comboToSlug({ bookingStatus, productTier, geography }: Partial<SegmentCombo>): string {
  const parts: string[] = [];
  parts.push(bookingStatus ? bookingStatus.toLowerCase().replace(/_/g, '-') : 'general');
  if (productTier) parts.push(productTier.toLowerCase());
  if (geography) parts.push(geography.toLowerCase());
  return parts.join('-');
}

export function slugToCombo(slug: string): SegmentCombo & { label: string } {
  const parts = slug.split('-');

  let bookingStatus: BookingStatus | null = null;
  let rest = parts;

  // Try matching status (may be 1-2 word slugs like "on-trip", "future-travel", "active-enquiry")
  for (const [key, val] of Object.entries(STATUS_MAP)) {
    if (slug.startsWith(key + '-') || slug === key) {
      bookingStatus = val;
      rest = slug.slice(key.length + 1).split('-').filter(Boolean);
      break;
    }
  }

  // If starts with "general", skip it
  if (!bookingStatus && parts[0] === 'general') {
    rest = parts.slice(1);
  }

  let productTier: ProductTier | null = null;
  let geography: Geography | null = null;

  for (const p of rest) {
    if (p === 'luxury') productTier = 'LUXURY';
    else if (p === 'standard') productTier = 'STANDARD';
    else if (p === 'local') geography = 'LOCAL';
    else if (p === 'international') geography = 'INTERNATIONAL';
  }

  // Build label
  const labelParts = [bookingStatus ? (STATUS_LABELS[bookingStatus] || bookingStatus) : 'General'];
  if (productTier) labelParts.push(productTier === 'LUXURY' ? 'Luxury' : 'Standard');
  if (geography) labelParts.push(geography === 'LOCAL' ? 'Local' : 'International');

  return { bookingStatus, productTier, geography, label: labelParts.join(' — ') };
}
