// unified_contacts.contact_type values — keep in sync with backend/src/utils/contactTypes.js
export const CONTACT_TYPES = ['B2C', 'B2B', 'Affiliate'];

// Sidebar Scope switch: every contact type plus "All"
export const SCOPES = ['All', ...CONTACT_TYPES];

export const CONTACT_TYPE_LABELS = {
  B2C: 'B2C — Individual',
  B2B: 'B2B — Business',
  Affiliate: 'Affiliate — Partner',
};

// What each scope covers, for page subtitles
export const SCOPE_DESCRIPTIONS = {
  All: 'All contacts',
  B2C: 'B2C end-customers',
  B2B: 'B2B partners & agents',
  Affiliate: 'Affiliate partners',
};

// Badge colours per type
export const CONTACT_TYPE_COLORS = {
  B2C: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
  B2B: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
  Affiliate: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981' },
};
export const contactTypeColor = (type) => CONTACT_TYPE_COLORS[type] || CONTACT_TYPE_COLORS.B2C;
