/**
 * Global search — pure helpers (no I/O): turn API rows into result rows and match pages.
 * Kept separate from the component so they can be unit-tested directly.
 */
import type {
  SearchContactRow, SearchJourneyRow, SearchPage, SearchResult, SearchSegmentRow, SearchTemplateRow,
} from '@/types/globalSearch';

/** Fewer characters than this never hit the server (1 letter would match half the contacts). */
export const MIN_QUERY_LENGTH = 2;
export const MAX_PAGE_RESULTS = 6;

const titleCase = (s: string | null | undefined): string | undefined => {
  const t = String(s ?? '').trim().replace(/_/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : undefined;
};
const joinMeta = (parts: (string | null | undefined)[]): string | undefined => {
  const out = parts.map(p => String(p ?? '').trim()).filter(Boolean).join(' · ');
  return out || undefined;
};
const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', rcs: 'RCS', push: 'Push' };

/** Menu pages whose label contains the query; with no query, every page (a "go to" list). */
export function matchPages(pages: SearchPage[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  const hits = q ? pages.filter(p => p.label.toLowerCase().includes(q)) : pages;
  return hits.slice(0, q ? MAX_PAGE_RESULTS : pages.length).map(p => ({
    key: `pages:${p.href}`, group: 'pages', href: p.href, title: p.label, meta: p.href,
  }));
}

export function journeyResult(r: SearchJourneyRow): SearchResult {
  return {
    key: `journeys:${r.journey_id}`, group: 'journeys', href: `/journeys/${r.journey_id}`,
    title: r.name?.trim() || `Journey #${r.journey_id}`,
    meta: joinMeta([`#${r.journey_id}`, r.segment_name]),
    tag: titleCase(r.status),
  };
}

export function templateResult(r: SearchTemplateRow): SearchResult {
  const ch = String(r.channel ?? '').toLowerCase();
  return {
    key: `templates:${r.id}`, group: 'templates', href: `/content/${r.id}`,
    title: r.name?.trim() || `Template #${r.id}`,
    meta: joinMeta([CHANNEL_LABEL[ch] ?? titleCase(ch), r.subject]),
    tag: titleCase(r.status),
  };
}

export function segmentResult(r: SearchSegmentRow): SearchResult {
  const n = Number(r.cached_count);
  return {
    key: `segments:${r.id}`, group: 'segments', href: `/segmentation/custom/${r.id}`,
    title: r.name?.trim() || `Segment #${r.id}`,
    meta: Number.isFinite(n) && r.cached_count !== null && r.cached_count !== undefined ? `${n.toLocaleString('en-US')} contacts` : undefined,
    tag: titleCase(r.status),
  };
}

export function contactResult(r: SearchContactRow): SearchResult {
  return {
    key: `contacts:${r.id}`, group: 'contacts', href: `/contacts/${r.id}`,
    title: r.name?.trim() || r.email?.trim() || r.mobile?.trim() || `Contact #${r.id}`,
    meta: joinMeta([r.email, r.mobile]),
    tag: r.contact_type?.trim() || undefined,
  };
}

/** The "see every match" row under the contacts group, linking to the Contacts list. */
export function allContactsResult(query: string, total: number): SearchResult {
  return {
    key: 'contacts:all', group: 'contacts', href: `/contacts?q=${encodeURIComponent(query.trim())}`,
    title: `See all ${total.toLocaleString('en-US')} matching contacts`,
  };
}
