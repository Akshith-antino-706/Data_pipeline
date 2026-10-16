import type { ContactType, Scope } from '@/types/api';

// unified_contacts.contact_type values — keep in sync with backend/src/utils/contactTypes.js
export const CONTACT_TYPES: ContactType[] = ['B2C', 'B2B', 'Affiliate'];

// Sidebar Scope switch: every contact type plus "All"
export const SCOPES: Scope[] = ['All', ...CONTACT_TYPES];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  B2C: 'B2C — Individual',
  B2B: 'B2B — Business',
  Affiliate: 'Affiliate — Partner',
};

// What each scope covers, for page subtitles
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  All: 'All contacts',
  B2C: 'B2C end-customers',
  B2B: 'B2B partners & agents',
  Affiliate: 'Affiliate partners',
};

export interface BadgeColors { bg: string; fg: string }

// Badge colours per type
export const CONTACT_TYPE_COLORS: Record<ContactType, BadgeColors> = {
  B2C: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
  B2B: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
  Affiliate: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
};

// Accepts any stored value; unknown types fall back to the B2C colours.
export const contactTypeColor = (type: string | null | undefined): BadgeColors =>
  (type && type in CONTACT_TYPE_COLORS ? CONTACT_TYPE_COLORS[type as ContactType] : undefined) || CONTACT_TYPE_COLORS.B2C;
