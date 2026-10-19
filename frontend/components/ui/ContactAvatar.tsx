export interface ContactAvatarProps {
  name?: string | null;
  fallback?: string | null;
  size?: number;
}

/** Initials of a name (or the first two characters of an email/phone fallback). */
export function contactInitials(name?: string | null, fallback?: string | null): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (fallback || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
}

export function ContactAvatar({ name, fallback, size = 56 }: ContactAvatarProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'var(--gold-soft)', color: 'var(--gold-ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: Math.round(size / 3.1),
      }}
    >
      {contactInitials(name, fallback)}
    </span>
  );
}
