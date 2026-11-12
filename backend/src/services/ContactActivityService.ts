/**
 * ContactActivityService — one page of a contact's activity timeline, merged and sorted on the server.
 *
 * Sources: email sends / opens / clicks / failures (email_send_log), bookings (rayna_*), website events
 * (gtm_events), WhatsApp chats (chats) and the contact's creation (unified_contacts). Read-only. Everything is keyed by
 * unified_id so each branch hits its unified_id index; only the requested page is returned.
 */
import pool from '../config/database.js';

export type ActivityKind = 'booking' | 'message' | 'website' | 'chat' | 'profile';
export const ACTIVITY_KINDS: ActivityKind[] = ['booking', 'message', 'website', 'chat', 'profile'];

export interface ActivityItem { kind: ActivityKind; at: string; dateOnly: boolean; title: string; sub?: string }
export interface ActivityPage {
  items: ActivityItem[]; total: number; page: number; limit: number; totalPages: number;
  /** How many items of each kind exist (all pages), so the UI can show only filters that have data. */
  kinds: Partial<Record<ActivityKind, number>>;
}

interface RawRow { kind: ActivityKind; at: Date | string; date_only: boolean; payload: Record<string, unknown> | null }
interface KindCountRow { kind: ActivityKind; n: string }

const BOOKING_TABLES: { table: string; label: string }[] = [
  { table: 'rayna_tours', label: 'Tour' }, { table: 'rayna_packages', label: 'Package' }, { table: 'rayna_hotels', label: 'Hotel' },
  { table: 'rayna_visas', label: 'Visa' }, { table: 'rayna_others', label: 'Other' }, { table: 'rayna_flights', label: 'Flight' },
];

// booking_date is text from the billing API — usually DD/MM/YYYY, sometimes ISO. Anything else is skipped.
const BOOKING_DAY = `CASE
  WHEN booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(booking_date, 'DD/MM/YYYY')::timestamptz
  WHEN booking_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(booking_date, 10)::date::timestamptz
END`;

const bookingBranch = (table: string, label: string) => `
  SELECT 'booking'::text AS kind, ${BOOKING_DAY} AS at, TRUE AS date_only,
         jsonb_build_object('type', '${label}', 'service_name', service_name, 'bill_no', bill_no,
                            'travel_date', travel_date, 'selling_price', selling_price, 'is_cancel', is_cancel) AS payload
  FROM ${table} WHERE unified_id = $1`;

const EMAIL_PAYLOAD = `jsonb_build_object('subject', e.subject, 'template_label', e.template_label, 'day_number', e.day_number,
                       'journey_id', e.journey_id, 'journey_name', jf.name, 'node_id', e.node_id, 'error', e.error_message)`;
const emailBranch = (event: string, at: string, where: string) => `
  SELECT 'message'::text AS kind, ${at} AS at, FALSE AS date_only, ${EMAIL_PAYLOAD} || jsonb_build_object('event', '${event}') AS payload
  FROM email_send_log e LEFT JOIN journey_flows jf ON jf.journey_id = e.journey_id
  WHERE e.unified_id = $1 AND ${where}`;

/** The UNION of every activity source for one contact ($1 = unified_id). */
const EVENTS_SQL = [
  emailBranch('sent', 'e.sent_at', 'e.sent_at IS NOT NULL'),
  emailBranch('opened', 'e.opened_at', 'e.opened_at IS NOT NULL'),
  emailBranch('clicked', 'e.clicked_at', 'e.clicked_at IS NOT NULL'),
  emailBranch('failed', 'e.created_at', "e.status = 'failed'"),
  ...BOOKING_TABLES.map(b => bookingBranch(b.table, b.label)),
  `SELECT 'website'::text AS kind, created_at AS at, FALSE AS date_only,
          jsonb_build_object('event_name', event_name, 'page_url', page_url, 'page_title', page_title, 'event_value', event_value,
                             'device_type', device_type, 'city', city, 'utm_source', utm_source) AS payload
   FROM gtm_events WHERE unified_id = $1`,
  `SELECT 'chat'::text AS kind, c.created_at AS at, FALSE AS date_only,
          jsonb_build_object('which', 'first', 'text', c.first_msg_text, 'name', c.wa_name) AS payload
   FROM chats c WHERE c.unified_id = $1 AND c.created_at IS NOT NULL`,
  `SELECT 'chat'::text AS kind, c.last_msg_at AS at, FALSE AS date_only,
          jsonb_build_object('which', 'last', 'text', c.last_msg, 'name', c.wa_name) AS payload
   FROM chats c WHERE c.unified_id = $1 AND c.last_msg_at IS NOT NULL AND c.last_msg_at IS DISTINCT FROM c.created_at`,
  `SELECT 'profile'::text AS kind, created_at AS at, FALSE AS date_only,
          jsonb_build_object('which', 'created', 'sources', sources) AS payload
   FROM unified_contacts WHERE id = $1 AND created_at IS NOT NULL`,
].join('\nUNION ALL\n');

const aed = (v: unknown): string => `AED ${(Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const str = (v: unknown): string => (v == null ? '' : String(v));
const humanize = (v: string): string => { const t = v.replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const pathOf = (u: string): string => { if (!u) return ''; try { return new URL(u).pathname; } catch { return u; } };
const dmy = (v: unknown): string => {
  const s = str(v); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};

/** Plain-language title/sub for one raw row. Wording matches what the profile page used to build client-side. */
export function describe(row: RawRow): { title: string; sub?: string } {
  const p = row.payload ?? {};
  switch (row.kind) {
    case 'message': {
      const what = str(p.subject) || str(p.template_label) || str(p.node_id) || 'email';
      const jn = str(p.journey_name) || (p.journey_id != null ? `Journey ${str(p.journey_id)}` : '');
      const step = p.day_number != null && p.day_number !== '' ? ` · day ${str(p.day_number)}` : '';
      const sub = jn ? `${jn}${step}` : undefined;
      switch (str(p.event)) {
        case 'opened': return { title: `Opened email “${what}”`, sub };
        case 'clicked': return { title: `Clicked a link in “${what}”`, sub };
        case 'failed': return { title: `Email failed “${what}”`, sub: [sub, str(p.error)].filter(Boolean).join(' · ') || undefined };
        default: return { title: `Sent email “${what}”`, sub };
      }
    }
    case 'booking': {
      const price = Number(p.selling_price) > 0 ? ` — ${aed(p.selling_price)}` : '';
      const sub = [str(p.type), p.bill_no && `Bill ${str(p.bill_no)}`, p.travel_date && `travel ${dmy(p.travel_date)}`, str(p.is_cancel) === '1' && 'Cancelled']
        .filter(Boolean).join(' · ');
      return { title: `Booked ${str(p.service_name) || str(p.type).toLowerCase()}${price}`, sub: sub || undefined };
    }
    case 'website': {
      const page = str(p.page_title) || pathOf(str(p.page_url));
      const sub = [str(p.page_title) ? pathOf(str(p.page_url)) : '', Number(p.event_value) > 0 ? aed(p.event_value) : '', str(p.device_type), str(p.city),
        str(p.utm_source) && `from ${str(p.utm_source)}`].filter(Boolean).join(' · ');
      return { title: `${humanize(str(p.event_name) || 'Website event')}${page ? ` · ${page}` : ''}`, sub: sub || undefined };
    }
    case 'chat':
      return { title: str(p.which) === 'first' ? 'Chat started' : 'Latest chat message', sub: str(p.text) || str(p.name) || undefined };
    case 'profile': {
      const sources = str(p.sources).split(',').map(x => x.trim()).filter(Boolean);
      return { title: 'Contact created', sub: sources.length ? `From ${sources.join(', ')}` : undefined };
    }
  }
}

export default class ContactActivityService {
  static async getActivity(id: string | number, opts: { page?: number; limit?: number; kind?: string } = {}): Promise<ActivityPage> {
    const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 30) || 30, 100));
    const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);
    const kind = ACTIVITY_KINDS.includes(opts.kind as ActivityKind) ? (opts.kind as ActivityKind) : null;

    const [countRes, pageRes] = await Promise.all([
      pool.query<KindCountRow>(`SELECT kind, COUNT(*)::text AS n FROM (${EVENTS_SQL}) ev WHERE at IS NOT NULL GROUP BY kind`, [id]),
      pool.query<RawRow>(
        `SELECT kind, at, date_only, payload FROM (${EVENTS_SQL}) ev
         WHERE at IS NOT NULL ${kind ? 'AND kind = $4' : ''}
         ORDER BY at DESC LIMIT $2 OFFSET $3`,
        kind ? [id, limit, (page - 1) * limit, kind] : [id, limit, (page - 1) * limit],
      ),
    ]);

    const kinds: Partial<Record<ActivityKind, number>> = {};
    for (const r of countRes.rows) kinds[r.kind] = parseInt(r.n, 10) || 0;
    const total = kind ? (kinds[kind] ?? 0) : Object.values(kinds).reduce((a, b) => a + b, 0);

    const items: ActivityItem[] = pageRes.rows.map(r => {
      const at = r.at instanceof Date ? r.at : new Date(String(r.at));
      return { kind: r.kind, at: at.toISOString(), dateOnly: Boolean(r.date_only), ...describe(r) };
    });
    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), kinds };
  }
}
