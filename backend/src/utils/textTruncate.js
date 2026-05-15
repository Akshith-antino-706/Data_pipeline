export const CARD_LIMITS = {
  EYEBROW: 22,
  TITLE: 50,
  META: 32,
  PRICE: 22,
  DESC: 90,
};

export const HERO_LIMITS = {
  TITLE: 60,
  SUB: 160,
};

export const STAT_LIMITS = {
  VALUE: 12,
  LABEL: 30,
};

export function truncate(str, max, suffix = '…') {
  if (str == null) return '';
  const s = String(str).trim();
  if (s.length <= max) return s;
  const slice = s.slice(0, max - suffix.length);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,.;:!?\-]+$/, '') + suffix;
}
