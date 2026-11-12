// Plain-language text helpers for the Templates page (display only — stored data is never changed).

/** A piece of display text: plain words, or a readable placeholder tag such as "[coupon code]". */
export type TextPart = { kind: 'text'; text: string } | { kind: 'tag'; text: string };

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** "coupon.code" → "coupon code", "cardOffer.title" → "card offer title", "commission.ratePercent" → "commission rate %". */
export function placeholderLabel(raw: string): string {
  const expr = raw.split('|')[0].trim();
  const words = expr
    .replace(/["'[\]]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(w => (w === 'percent' || w === 'pct' ? '%' : w));
  return words.length ? `[${words.join(' ')}]` : '[field]';
}

/** Split text into plain parts and readable placeholder tags. */
export function splitPlaceholders(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'tag', text: placeholderLabel(m[1]) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The same text with every placeholder written as a readable tag (for titles and tooltips). */
export function readablePlaceholders(text: string): string {
  return splitPlaceholders(text).map(p => p.text).join('');
}

const ENTITIES: Record<string, string | undefined> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–', copy: '©', reg: '®', trade: '™', zwnj: '', zwj: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = ENTITIES[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Lines/sentences that are notes for developers, not message text.
const DEV_NOTE_RE = /\b(helpers?|dev(eloper)? notes?|notes? for dev(eloper)?s?|todo|fixme|available (vars|variables|helpers|fields)|usage|liquid)\s*:/i;
// Characters that show up in code far more than in marketing copy.
const CODE_CHARS_RE = /[{};<>=]/g;

function looksLikeCode(line: string): boolean {
  if (/!important|@media|@import|@font-face|([a-z-]+\s*:\s*[^;:{}]+;\s*){2,}/i.test(line)) return true;
  if (/^[\w\s.#,:>*()[\]="'-]+\{/.test(line)) return true;
  if (/^(function|var|let|const|if|for|return)\b|=>|\(\)\s*\{/.test(line)) return true;
  const codeChars = (line.match(CODE_CHARS_RE) || []).length;
  return line.length > 0 && codeChars / line.length > 0.05;
}

/**
 * A short, human-readable excerpt from a template body: strips <head>/<style>/<script>,
 * comments, Liquid tags and every HTML tag, decodes entities, drops CSS and developer
 * notes, and collapses whitespace. Placeholders ({{…}}) are kept so the caller can show
 * them as readable tags. Returns '' rather than anything that looks like code.
 */
export function cleanExcerpt(source: string | null | undefined, maxLen = 220): string {
  if (!source) return '';
  // Protect placeholders so the CSS-block stripping below can't eat them.
  const keep: string[] = [];
  let s = String(source).replace(PLACEHOLDER_RE, m => { keep.push(m); return `\uE000${keep.length - 1}\uE000`; });
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|style|script|title|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(head|style|script)\b[^>]*>[\s\S]*$/gi, ' ') // unclosed block
    .replace(/\{%-?[\s\S]*?-?%\}/g, ' ') // Liquid logic tags
    .replace(/<(br|\/p|\/div|\/tr|\/td|\/th|\/li|\/h[1-6]|\/table|\/section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  // CSS rule blocks left in plain text (e.g. from a stripped-tags body_plain); twice for @media nesting.
  for (let i = 0; i < 2; i++) {
    s = s.replace(/[^{}\n]*\{[^{}]*\}/g, block => (/[:;]/.test(block) || /\{\s*\}$/.test(block) ? ' ' : block));
  }
  const lines = s
    .split(/\n+/)
    .map(l => l.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .map(l => {
      const note = l.search(DEV_NOTE_RE);
      return note >= 0 ? l.slice(0, note).trim() : l;
    })
    .filter(l => l && !looksLikeCode(l.replace(/\uE000\d+\uE000/g, 'x')));
  let out = lines.join(' ').replace(/\s+/g, ' ').trim();
  out = out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => keep[Number(i)] ?? '');
  if (!/[A-Za-z\u00c0-\uffff]{2,}/.test(out.replace(PLACEHOLDER_RE, ''))) return '';
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

/** "affiliate_01_joined" → "Affiliate 01 joined". Names that already read well are returned as-is. */
export function readableTitle(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return 'Untitled template';
  if (/\s/.test(n) || !/[_-]/.test(n)) return n;
  const words = n.split(/[_-]+/).filter(Boolean).join(' ').toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : n;
}

/** "3 days ago", "yesterday", "just now"; older than ~4 weeks → "12 Mar 2026". '' when unknown. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.round((now - t) / 1000);
  if (sec < 0) return exactDay(iso);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 28) return `${day} days ago`;
  return exactDay(iso);
}

/** "12 Mar 2026". '' when unknown. */
export function exactDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "12 Mar 2026, 3:49 PM". '' when unknown. */
export function exactDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
