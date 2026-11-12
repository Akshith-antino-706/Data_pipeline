// Shared types for the backend API. Field names and value types mirror what the backend
// sends over JSON: timestamps arrive as ISO strings and Postgres `numeric` sums as strings.
// Endpoints whose response hasn't been mapped yet return `unknown` from lib/api, so callers
// must check the shape before use.

/** Primary keys are serial ints in Postgres but often travel through the UI as strings. */
export type Id = string | number;

/** Values accepted in a query string; URLSearchParams stringifies each one. */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** Anything JSON.stringify can serialise as a request body. */
export type JsonBody = unknown;

/** Standard `{ success, data }` envelope used by most routes. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export type ContactType = 'B2C' | 'B2B' | 'Affiliate';
export type Scope = 'All' | ContactType;

/** GET /api/v3/unified-contacts/stats → data */
export interface UnifiedStats {
  total_contacts: number;
  with_travel: number;
  multi_source: number;
  countries: number;
  /** SUM(numeric) → string from pg, or 0 when there are no bookings */
  total_revenue: string | number;
  total_bookings: number;
  conversations_7d: number;
}

/** GET /api/v3/unified-contacts/sources-breakdown → data */
export interface SourcesBreakdown {
  from: string | null;
  to: string | null;
  total: number;
  sources: { source: string; count: number }[];
}

// ── Send log ──────────────────────────────────────────────────────────────────

export type SendStatus = 'queued' | 'sent' | 'opened' | 'clicked' | 'failed' | 'skipped' | string;

/** One row of GET /api/v3/test-sends/send-log (email_send_log + contact name). */
export interface SendLogRow {
  id: number;
  unified_id: number | null;
  email: string;
  contact_name: string | null;
  subject: string | null;
  template_label: string | null;
  day_number: number | null;
  source: string | null;
  journey_id: number | null;
  node_id: string | null;
  external_id: string | null;
  provider: string | null;
  status: SendStatus;
  error_message: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  duration_ms: number | null;
  created_at: string;
  uc_name: string | null;
  /** unified_contacts.email_unsubscribe ('Yes' / 'No' / null) */
  email_unsubscribed: string | null;
}

/** GET /api/v3/test-sends/send-log → data */
export interface SendLogPage {
  rows: SendLogRow[];
  total: number;
  page: number;
  limit: number;
  /** true when `total` is the planner estimate (no filters applied) */
  estimated: boolean;
  /** true when a filtered count stopped at the cap; show as "10,000+" */
  capped?: boolean;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
}

export interface AuthData {
  token: string;
  refreshToken?: string;
  user: AuthUser;
}

// ── Giveaways ─────────────────────────────────────────────────────────────────

/** An event from /api/v3/giveaways/log (BullMQ) or /mq-log (RabbitMQ). */
export interface GiveawayEvent {
  id?: string;
  jobId?: string;
  ts?: string;
  type?: string;
  outcome?: string;
  label?: string;
  name?: string;
  email?: string;
  detail?: string;
  reason?: string;
  subject?: string;
}

export interface GiveawayLog {
  events?: GiveawayEvent[];
}
