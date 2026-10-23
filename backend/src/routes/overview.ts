/**
 * READ-ONLY overview endpoints for the redesigned UI (Home, Insights, Status,
 * Messages, Website). Every SQL statement here is a plain SELECT / WITH … SELECT.
 *
 * Each response is built from independent sections: a section whose query fails
 * returns { available: false, reason: 'unavailable' } and the rest still return.
 * Table/column usage is copied from existing services (JourneyStatsService,
 * JourneyService, SendTrackService, DailyReportService, GTMService, UTMService).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { QueryConfig } from 'pg';
import db from '../config/database.js';
import { queueCounts } from '../services/queue/index.js';
import UTMService from '../services/UTMService.js';
import { clampInt, isIsoDate, parseId } from '../utils/validate.js';

const router = Router();

// ── Section helpers ───────────────────────────────────────────────────────────
export type Unavailable = { available: false; reason: 'unavailable' };
export type TimedOut = { available: false; reason: 'timeout' };
export type Section<T> = ({ available: true } & T) | Unavailable | TimedOut;

async function section<T extends object>(name: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    const data = await fn();
    return { available: true, ...data };
  } catch (err) {
    console.error(`[overview] section ${name} failed:`, (err as Error).message);
    return { available: false, reason: 'unavailable' };
  }
}

/** Numeric coercion that never yields NaN (pg returns COUNT/SUM as strings or null). */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

// Dubai "today" start, as a timestamptz expression (sargable against indexed timestamps).
const DUBAI_TODAY = `(date_trunc('day', NOW() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai')`;
const DUBAI_TOMORROW = `((date_trunc('day', NOW() AT TIME ZONE 'Asia/Dubai') + INTERVAL '1 day') AT TIME ZONE 'Asia/Dubai')`;
/** $n::date (a Dubai calendar date) → timestamptz at Dubai midnight. */
const dubaiStart = (p: string) => `(${p}::date::timestamp AT TIME ZONE 'Asia/Dubai')`;

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

function dubaiTodayIso(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export interface DateRange { from: string; to: string; days: number }
/** Validated inclusive [from, to] Dubai-date range; defaults to the last 30 days; max 366 days. */
export function parseRange(fromQ: unknown, toQ: unknown, defDays = 30): DateRange {
  const today = dubaiTodayIso();
  let to = isIsoDate(toQ) ? toQ : today;
  if (to > today) to = today;
  let from = isIsoDate(fromQ) ? fromQ : addDays(to, -(defDays - 1));
  if (from > to) from = to;
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to, days: daysBetween(from, to) + 1 };
}

type CountRow = Record<string, string | number | null>;

// ── Shared channel queries ────────────────────────────────────────────────────
// "Sent" rules mirror JourneyStatsService (status NOT IN ('failed','queued')).
// Email time column: sent_at (SendTrackService/JourneyStatsService). WhatsApp: created_at
// (SendTrackService.getWhatsAppLog). SMS: sent_at (migration 103 index).

// ── Home sections ─────────────────────────────────────────────────────────────
// Each Home card is an independent section with its own endpoint (GET /home/:section),
// an ~8s time limit and an in-memory cache, so a slow query only delays its own card.

/** Wall-clock limit per Home section; the same limit is passed to pg as query_timeout. */
export const HOME_SECTION_TIMEOUT_MS = 8_000;
/**
 * pg query_timeout for Home queries. Longer than the wall-clock limit on purpose: when a
 * section misses the 8s response window, its queries keep running in the background and the
 * result is cached when they finish, so the next request is served instantly.
 */
export const HOME_QUERY_TIMEOUT_MS = 60_000;
/** Fresh window for a successful section result. */
export const HOME_CACHE_TTL_MS = 120_000;
/** A successful result older than the TTL is still served (and refreshed in the background) up to this age. */
export const HOME_STALE_MAX_MS = 600_000;
/** Unavailable/timeout results are only reused for this long. */
export const HOME_FAIL_TTL_MS = 15_000;

/**
 * pg reads `query_timeout` from the per-query config (pg/lib/client.js) although
 * @types/pg's QueryConfig does not declare it. On expiry pg rejects the query and the
 * pool discards that client, so the connection does not stay busy behind a slow query.
 */
type TimedQueryConfig = QueryConfig & { query_timeout: number };
function hq(text: string, values: unknown[] = []) {
  const config: TimedQueryConfig = { text, values, query_timeout: HOME_QUERY_TIMEOUT_MS };
  return db.query<CountRow>(config);
}

async function homeSentBetween(startExpr: string, endExpr: string) {
  const [e, w, s] = await Promise.all([
    // sent_at is only set once an email is actually sent (failed/queued rows have NULL), so the
    // range alone means "sent" and the count can be answered from the sent_at index.
    hq(`SELECT COUNT(*) AS n FROM email_send_log
      WHERE sent_at >= ${startExpr} AND sent_at < ${endExpr}`),
    hq(`SELECT COUNT(*) AS n FROM whatsapp_send_log
      WHERE created_at >= ${startExpr} AND created_at < ${endExpr} AND status NOT IN ('failed','queued')`),
    hq(`SELECT COUNT(*) AS n FROM sms_send_log
      WHERE sent_at >= ${startExpr} AND sent_at < ${endExpr} AND status NOT IN ('failed','queued','blocked')`),
  ]);
  const email = num(e.rows[0]?.n), whatsapp = num(w.rows[0]?.n), sms = num(s.rows[0]?.n);
  return { email, whatsapp, sms, total: email + whatsapp + sms };
}

type ChannelCounts = { email: number; whatsapp: number; sms: number; total: number };
/** Past-day counts are immutable; keep them long. Today's count stays fresh. */
const SERIES_PAST_TTL_MS = 6 * 60 * 60 * 1000;
const SERIES_TODAY_TTL_MS = 120_000;
const seriesDayCache = new Map<string, { at: number; v: ChannelCounts }>();
/** Dubai-midnight timestamp `k` days ago; k is an internal integer 0–14, never user input. */
const dubaiDayStart = (k: number) => `((date_trunc('day', NOW() AT TIME ZONE 'Asia/Dubai') - INTERVAL '${Math.trunc(k)} days') AT TIME ZONE 'Asia/Dubai')`;
/** Email sent on one Dubai day — answered from idx_esl_sent_at; past days cached 6h. */
async function seriesEmailDay(date: string, k: number): Promise<number> {
  const hit = seriesDayCache.get(date);
  const ttl = k === 0 ? SERIES_TODAY_TTL_MS : SERIES_PAST_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.v.email;
  const { rows } = await hq(`SELECT COUNT(*) AS n FROM email_send_log
    WHERE sent_at >= ${dubaiDayStart(k)} AND sent_at < ${k === 0 ? DUBAI_TOMORROW : dubaiDayStart(k - 1)}`);
  const email = num(rows[0]?.n);
  seriesDayCache.set(date, { at: Date.now(), v: { email, whatsapp: 0, sms: 0, total: email } });
  if (seriesDayCache.size > 40) for (const key of [...seriesDayCache.keys()].sort().slice(0, seriesDayCache.size - 40)) seriesDayCache.delete(key);
  return email;
}

/**
 * WhatsApp and SMS logs have no index on their time column, so per-day counts would scan each
 * table 14 times. Instead read each table ONCE for the whole 14-day window, grouped by Dubai day,
 * and cache that for 10 minutes.
 */
const WA_SMS_SERIES_TTL_MS = 10 * 60 * 1000;
let waSmsSeriesCache: { at: number; wa: Map<string, number>; sms: Map<string, number> } | null = null;
async function waSmsSeries(): Promise<{ wa: Map<string, number>; sms: Map<string, number> }> {
  if (waSmsSeriesCache && Date.now() - waSmsSeriesCache.at < WA_SMS_SERIES_TTL_MS) return waSmsSeriesCache;
  const day = (col: string) => `to_char((${col} AT TIME ZONE 'Asia/Dubai')::date, 'YYYY-MM-DD')`;
  const start = dubaiDayStart(13);
  const [w, s] = await Promise.all([
    hq(`SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM whatsapp_send_log
      WHERE created_at >= ${start} AND created_at < ${DUBAI_TOMORROW} AND status NOT IN ('failed','queued') GROUP BY 1`),
    hq(`SELECT ${day('sent_at')} AS d, COUNT(*) AS n FROM sms_send_log
      WHERE sent_at >= ${start} AND sent_at < ${DUBAI_TOMORROW} AND status NOT IN ('failed','queued','blocked') GROUP BY 1`),
  ]);
  const toMap = (rows: CountRow[]) => new Map(rows.map(r => [String(r.d), num(r.n)]));
  waSmsSeriesCache = { at: Date.now(), wa: toMap(w.rows), sms: toMap(s.rows) };
  return waSmsSeriesCache;
}

/**
 * Finished-day totals from daily_send_counts (migration 119), keyed by YYYY-MM-DD. Only days
 * with all three channels are used. Missing table / any error → empty map (live counting).
 */
async function storedDailyCounts(): Promise<Map<string, { email: number; whatsapp: number; sms: number }>> {
  const out = new Map<string, { email: number; whatsapp: number; sms: number }>();
  try {
    const { rows } = await hq(`SELECT to_char(day, 'YYYY-MM-DD') AS d, channel, sent FROM daily_send_counts
      WHERE day >= (NOW() AT TIME ZONE 'Asia/Dubai')::date - 13 AND day < (NOW() AT TIME ZONE 'Asia/Dubai')::date`);
    const acc = new Map<string, { email?: number; whatsapp?: number; sms?: number }>();
    for (const r of rows) {
      const d = String(r.d), ch = String(r.channel);
      const e = acc.get(d) ?? {};
      if (ch === 'email' || ch === 'whatsapp' || ch === 'sms') e[ch] = num(r.sent);
      acc.set(d, e);
    }
    for (const [d, e] of acc) {
      if (e.email !== undefined && e.whatsapp !== undefined && e.sms !== undefined) out.set(d, { email: e.email, whatsapp: e.whatsapp, sms: e.sms });
    }
  } catch { /* table not created yet — fall back to live counts */ }
  return out;
}

/** Cap for the per-journey "joined" counts on Home (keeps each count bounded). */
const JOINED_COUNT_CAP = 100_000;

const HOME_SECTION_FNS = {
  sentToday: () => homeSentBetween(DUBAI_TODAY, DUBAI_TOMORROW),

  delivery7d: async () => {
    // One scan per channel, bounded by its time column. Email "delivered" comes from
    // email_send_log.status, which sesWebhook advances queued/sent → delivered → opened → clicked
    // on SES events, so delivered/opened/clicked all imply a Delivery — no ses_events join.
    const [e, w, s] = await Promise.all([
      hq(`SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
          COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked')) AS delivered
        FROM email_send_log WHERE sent_at >= NOW() - INTERVAL '7 days' AND sent_at < NOW()`),
      hq(`SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
          COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered
        FROM whatsapp_send_log WHERE created_at >= NOW() - INTERVAL '7 days' AND created_at < NOW()`),
      hq(`SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('failed','queued','blocked')) AS sent,
          COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered
        FROM sms_send_log WHERE sent_at >= NOW() - INTERVAL '7 days' AND sent_at < NOW()`),
    ]);
    const E0 = e.rows[0] ?? {}, W0 = w.rows[0] ?? {}, S0 = s.rows[0] ?? {};
    const sent = num(E0.sent) + num(W0.sent) + num(S0.sent);
    const delivered = num(E0.delivered) + num(W0.delivered) + num(S0.delivered);
    return { sent, delivered, deliveredPct: pct(delivered, sent) };
  },

  conversions30d: async () => {
    // JourneyService exits: status 'exited' + exit_reason booked/purchased (completed_at set), or status 'converted'.
    const { rows } = await hq(`SELECT COUNT(*) AS n FROM journey_entries
      WHERE completed_at >= NOW() - INTERVAL '30 days' AND completed_at < NOW()
        AND (status = 'converted' OR exit_reason IN ('booked','purchased'))`);
    return { count: num(rows[0]?.n) };
  },

  runningJourneys: async () => {
    // Top 5 only. Joined = the larger of the stored total (segment journeys) and the
    // GTM/giveaway entries table, which continuous journeys use instead of journey_entries.
    // The per-row subqueries run only for the 5 kept rows and each stops at JOINED_COUNT_CAP.
    const { rows } = await hq(`WITH top AS (
        SELECT jf.journey_id, jf.name, jf.status, COALESCE(jf.total_entries, 0) AS stored, COUNT(*) OVER () AS running_total
        FROM journey_flows jf WHERE jf.status = 'active'
        ORDER BY jf.updated_at DESC NULLS LAST LIMIT 5)
      SELECT t.journey_id, t.name, t.status, t.running_total,
        GREATEST(t.stored,
          (SELECT COUNT(*) FROM (SELECT 1 FROM journey_entries je WHERE je.journey_id = t.journey_id LIMIT ${JOINED_COUNT_CAP}) je_capped),
          (SELECT COUNT(*) FROM (SELECT 1 FROM gtm_journey_entries g WHERE g.journey_id = t.journey_id LIMIT ${JOINED_COUNT_CAP}) g_capped)) AS joined
      FROM top t`);
    return {
      total: num(rows[0]?.running_total),
      journeys: rows.map(r => ({ id: num(r.journey_id), name: String(r.name ?? ''), status: String(r.status ?? ''), joined: num(r.joined) })),
    };
  },

  sendingToday: async () => {
    // Active entries whose next send is due before the end of today (Dubai), including overdue
    // ones still waiting. Segment journeys use journey_entries; GTM/giveaway journeys use
    // gtm_journey_entries, where next_fire_at NULL means "fire as soon as possible".
    const { rows } = await hq(`WITH due AS (
        SELECT je.journey_id FROM journey_entries je
        WHERE je.status = 'active' AND je.next_fire_at < ${DUBAI_TOMORROW}
        UNION ALL
        SELECT g.journey_id FROM gtm_journey_entries g
        WHERE g.status = 'active' AND (g.next_fire_at IS NULL OR g.next_fire_at < ${DUBAI_TOMORROW})
      )
      SELECT d.journey_id, jf.name, COUNT(*) AS due, SUM(COUNT(*)) OVER () AS all_due
      FROM due d JOIN journey_flows jf ON jf.journey_id = d.journey_id
      WHERE jf.status = 'active'
      GROUP BY d.journey_id, jf.name ORDER BY due DESC LIMIT 5`);
    const journeys = rows.map(r => ({ id: num(r.journey_id), name: String(r.name ?? ''), due: num(r.due) }));
    return { journeys, total: rows.length ? num(rows[0].all_due) : 0 };
  },

  series14d: async () => {
    // Finished days come from daily_send_counts (14 tiny rows, filled nightly) when present.
    // Any day not in that table — and today, which is still changing — is counted live:
    // email per day on idx_esl_sent_at, WhatsApp/SMS via one grouped read.
    const today = dubaiTodayIso();
    const offsets = Array.from({ length: 14 }, (_, i) => 13 - i); // 13 … 0 days ago
    const stored = await storedDailyCounts();
    const needLive = offsets.filter(k => k === 0 || !stored.has(addDays(today, -k)));
    const waSmsP = needLive.length ? waSmsSeries() : Promise.resolve({ wa: new Map<string, number>(), sms: new Map<string, number>() });
    const liveEmail = new Map<number, number>();
    for (let i = 0; i < needLive.length; i += 4) {
      const batch = needLive.slice(i, i + 4);
      const vals = await Promise.all(batch.map(k => seriesEmailDay(addDays(today, -k), k)));
      batch.forEach((k, j) => liveEmail.set(k, vals[j]));
    }
    const { wa, sms } = await waSmsP;
    const days = offsets.map(k => {
      const date = addDays(today, -k);
      const st = k === 0 ? undefined : stored.get(date);
      const email = st ? st.email : liveEmail.get(k) ?? 0;
      const whatsapp = st ? st.whatsapp : wa.get(date) ?? 0;
      const smsN = st ? st.sms : sms.get(date) ?? 0;
      return { date, email, whatsapp, sms: smsN, total: email + whatsapp + smsN };
    });
    return { days };
  },
} as const;

export type HomeSectionName = keyof typeof HOME_SECTION_FNS;
export const HOME_SECTIONS = Object.keys(HOME_SECTION_FNS) as HomeSectionName[];
type HomeSectionResult<K extends HomeSectionName> = Section<Awaited<ReturnType<(typeof HOME_SECTION_FNS)[K]>>>;
type AnyHomeResult = HomeSectionResult<HomeSectionName>;

function isHomeSection(s: string): s is HomeSectionName {
  return Object.prototype.hasOwnProperty.call(HOME_SECTION_FNS, s);
}

interface HomeCacheEntry { value: AnyHomeResult; at: number }
const homeCache = new Map<HomeSectionName, HomeCacheEntry>();
const homeInFlight = new Map<HomeSectionName, Promise<AnyHomeResult>>();

/** Test hook: clears the Home section cache. */
export function resetHomeCache(): void {
  homeCache.clear();
  seriesDayCache.clear();
  waSmsSeriesCache = null;
  homeInFlight.clear();
}

/** Stores a finished result, keeping a still-usable good value rather than a failure. */
function storeHomeSection(name: HomeSectionName, value: AnyHomeResult): AnyHomeResult {
  const prev = homeCache.get(name);
  const keepPrev = !value.available && prev?.value.available && Date.now() - prev.at < HOME_STALE_MAX_MS;
  if (!keepPrev) homeCache.set(name, { value, at: Date.now() });
  return keepPrev && prev ? prev.value : value;
}

/**
 * Starts (or joins) the background computation of a section. The computation is NOT cut off
 * at the response limit — it runs until done (bounded by HOME_QUERY_TIMEOUT_MS in pg) and its
 * result is cached, so a slow section fills in on a later request instead of timing out forever.
 */
function computeHomeSection(name: HomeSectionName): Promise<AnyHomeResult> {
  const pending = homeInFlight.get(name);
  if (pending) return pending;
  const p = (section<object>(name, HOME_SECTION_FNS[name]) as Promise<AnyHomeResult>)
    .then(value => storeHomeSection(name, value))
    .finally(() => { homeInFlight.delete(name); });
  homeInFlight.set(name, p);
  return p;
}

/** Waits for a section up to the response limit; never throws. A timeout leaves it computing. */
async function refreshHomeSection(name: HomeSectionName): Promise<AnyHomeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedOut>(resolve => {
    timer = setTimeout(() => resolve({ available: false, reason: 'timeout' }), HOME_SECTION_TIMEOUT_MS);
  });
  try {
    return await Promise.race<AnyHomeResult>([computeHomeSection(name), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cached section: fresh for 120s, stale-while-revalidate up to 10 min, failures for 15s. */
export async function getHomeSection<K extends HomeSectionName>(name: K): Promise<HomeSectionResult<K>> {
  const hit = homeCache.get(name);
  if (hit) {
    const age = Date.now() - hit.at;
    const fresh = hit.value.available ? age < HOME_CACHE_TTL_MS : age < HOME_FAIL_TTL_MS;
    if (fresh) return hit.value as HomeSectionResult<K>;
    if (hit.value.available && age < HOME_STALE_MAX_MS) {
      void refreshHomeSection(name);
      return hit.value as HomeSectionResult<K>;
    }
  }
  return (await refreshHomeSection(name)) as HomeSectionResult<K>;
}

// ── GET /home (all sections; kept for compatibility) ─────────────────────────
router.get('/home', async (_req: Request, res: Response) => {
  const [sentToday, delivery7d, conversions30d, runningJourneys, sendingToday, series14d] = await Promise.all([
    getHomeSection('sentToday'), getHomeSection('delivery7d'), getHomeSection('conversions30d'),
    getHomeSection('runningJourneys'), getHomeSection('sendingToday'), getHomeSection('series14d'),
  ]);
  res.json({ sentToday, delivery7d, conversions30d, runningJourneys, sendingToday, series14d });
});

// ── GET /home/:section ────────────────────────────────────────────────────────
router.get('/home/:section', async (req: Request, res: Response) => {
  const name = String(req.params.section ?? '');
  if (!isHomeSection(name)) {
    res.status(400).json({ error: `Unknown section. Use one of: ${HOME_SECTIONS.join(', ')}` });
    return;
  }
  res.json(await getHomeSection(name));
});

// ── GET /insights ─────────────────────────────────────────────────────────────
async function totalsFor(from: string, toExclusive: string) {
  const p = [from, toExclusive];
  const S = dubaiStart('$1'), E = dubaiStart('$2');
  // One scan per log. Email "delivered" uses the status the SES webhook moves forward
  // (delivered → opened → clicked) instead of joining the large ses_events table.
  const [e, w, s, u] = await Promise.all([
    hq(`SELECT
        COUNT(*) AS sent,
        COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked')) AS delivered,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
      FROM email_send_log WHERE sent_at >= ${S} AND sent_at < ${E}`, p),
    hq(`SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
        COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS opened
      FROM whatsapp_send_log WHERE created_at >= ${S} AND created_at < ${E}`, p),
    hq(`SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('failed','queued','blocked')) AS sent,
        COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered
      FROM sms_send_log WHERE sent_at >= ${S} AND sent_at < ${E}`, p),
    hq(`SELECT COUNT(*) AS n FROM unsubscribe_log
      WHERE unsubscribed_at >= ${S} AND unsubscribed_at < ${E}`, p),
  ]);
  const E0 = e.rows[0] ?? {}, W0 = w.rows[0] ?? {}, S0 = s.rows[0] ?? {};
  return {
    sent: num(E0.sent) + num(W0.sent) + num(S0.sent),
    delivered: num(E0.delivered) + num(W0.delivered) + num(S0.delivered),
    opened: num(E0.opened) + num(W0.opened),
    clicked: num(E0.clicked),
    unsubscribed: num(u.rows[0]?.n),
    // Email-only figures, reused by the funnel so the email log isn't scanned again.
    email: { sent: num(E0.sent), opened: num(E0.opened), clicked: num(E0.clicked) },
  };
}

/** Insights responses cached per range: finished ranges for 30 min, ranges touching today for 3 min. */
const INSIGHTS_TTL_PAST_MS = 30 * 60 * 1000;
const INSIGHTS_TTL_LIVE_MS = 3 * 60 * 1000;
const insightsCache = new Map<string, { at: number; ttl: number; body: object }>();
const insightsInFlight = new Map<string, Promise<object>>();
/** Test hook. */
export function resetInsightsCache(): void { insightsCache.clear(); insightsInFlight.clear(); }

router.get('/insights', async (req: Request, res: Response) => {
  const range = parseRange(req.query.from, req.query.to);
  // The per-journey breakdown is heavy and the Performance page no longer shows it
  // (its journeys table has its own paged endpoint), so it is only computed on request.
  const withJourneys = req.query.include === 'journeys';
  const key = `${range.from}|${range.to}|${withJourneys ? 'j' : ''}`;
  const hit = insightsCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) { res.json(hit.body); return; }
  let job = insightsInFlight.get(key);
  if (!job) {
    job = computeInsights(range, withJourneys).then(body => {
      const failed = Object.values(body).some(v => typeof v === 'object' && v !== null && 'available' in v && (v as { available: boolean }).available === false);
      const ttl = failed ? 15_000 : range.to < dubaiTodayIso() ? INSIGHTS_TTL_PAST_MS : INSIGHTS_TTL_LIVE_MS;
      insightsCache.set(key, { at: Date.now(), ttl, body });
      if (insightsCache.size > 50) insightsCache.delete(insightsCache.keys().next().value as string);
      return body;
    }).finally(() => { insightsInFlight.delete(key); });
    insightsInFlight.set(key, job);
  }
  res.json(await job);
});

async function computeInsights(range: ReturnType<typeof parseRange>, withJourneys: boolean): Promise<object> {
  const toEx = addDays(range.to, 1);
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(prevTo, -(range.days - 1));
  const p = [range.from, toEx];
  const S = dubaiStart('$1'), E = dubaiStart('$2');

  // Current-period totals are computed once and shared by the totals and funnel sections.
  const currentP = totalsFor(range.from, toEx);
  currentP.catch(() => { /* surfaced per section */ });

  const [totals, previous, weeklyTrend, funnel, journeys] = await Promise.all([
    section('totals', async () => { const t = await currentP; return { sent: t.sent, delivered: t.delivered, opened: t.opened, clicked: t.clicked, unsubscribed: t.unsubscribed }; }),
    section('previous', async () => { const t = await totalsFor(prevFrom, addDays(prevTo, 1)); return { from: prevFrom, to: prevTo, sent: t.sent, delivered: t.delivered, opened: t.opened, clicked: t.clicked, unsubscribed: t.unsubscribed }; }),

    section('weeklyTrend', async () => {
      const { rows } = await hq(`SELECT
          to_char(date_trunc('week', sent_at AT TIME ZONE 'Asia/Dubai'), 'YYYY-MM-DD') AS week,
          COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
          COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
          COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
        FROM email_send_log WHERE sent_at >= ${S} AND sent_at < ${E}
        GROUP BY 1 ORDER BY 1 LIMIT 60`, p);
      return {
        weeks: rows.map(r => {
          const sent = num(r.sent), opened = num(r.opened), clicked = num(r.clicked);
          return { week: String(r.week), sent, opened, clicked, openRate: pct(opened, sent), clickRate: pct(clicked, sent) };
        }),
      };
    }),

    section('funnel', async () => {
      // Reuse the shared totals; if they failed (e.g. the unsubscribe count), count email alone.
      const emailOnly = async () => {
        const { rows } = await hq(`SELECT COUNT(*) AS sent,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
          FROM email_send_log WHERE sent_at >= ${S} AND sent_at < ${E}`, p);
        const r = rows[0] ?? {};
        return { email: { sent: num(r.sent), opened: num(r.opened), clicked: num(r.clicked) } };
      };
      const [t, c] = await Promise.all([
        currentP.catch(emailOnly),
        hq(`SELECT COUNT(*) AS n FROM journey_entries
          WHERE completed_at >= ${S} AND completed_at < ${E}
            AND (status = 'converted' OR exit_reason IN ('booked','purchased'))`, p),
      ]);
      return { channel: 'email' as const, sent: t.email.sent, opened: t.email.opened, clicked: t.email.clicked, converted: num(c.rows[0]?.n) };
    }),

    withJourneys
      ? section('journeys', async () => {
      const { rows } = await hq(`WITH s AS (
          SELECT journey_id,
            COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
          FROM email_send_log
          WHERE sent_at >= ${S} AND sent_at < ${E} AND journey_id IS NOT NULL
          GROUP BY journey_id
        ), u AS (
          SELECT journey_id, COUNT(*) AS unsubscribed FROM unsubscribe_log
          WHERE unsubscribed_at >= ${S} AND unsubscribed_at < ${E} AND journey_id IS NOT NULL
          GROUP BY journey_id
        )
        SELECT s.journey_id, jf.name, jf.status, s.sent, s.opened, s.clicked, COALESCE(u.unsubscribed, 0) AS unsubscribed
        FROM s LEFT JOIN journey_flows jf ON jf.journey_id = s.journey_id
        LEFT JOIN u ON u.journey_id = s.journey_id
        ORDER BY s.sent DESC LIMIT 50`, p);
      return {
        rows: rows.map(r => {
          const sent = num(r.sent), opened = num(r.opened), clicked = num(r.clicked);
          return {
            id: num(r.journey_id), name: String(r.name ?? `Journey ${num(r.journey_id)}`), status: str(r.status),
            sent, opened, clicked, unsubscribed: num(r.unsubscribed),
            openRate: pct(opened, sent), clickRate: pct(clicked, sent),
          };
        }),
      };
    })
      : Promise.resolve({ available: false as const, reason: 'unavailable' as const }),
  ]);
  return { range, totals, previous, weeklyTrend, funnel, journeys };
}

// ── GET /status ───────────────────────────────────────────────────────────────
const QUEUE_CHANNELS = ['email', 'whatsapp', 'sms', 'rcs', 'welcome', 'gtmJourney'] as const;
const QUEUE_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([p, t]).finally(() => { if (timer) clearTimeout(timer); });
}

const STATUS_SECTIONS = ['dataSources', 'queues', 'failedSends'] as const;
type StatusSection = typeof STATUS_SECTIONS[number];
const STATUS_SKIPPED = { available: false as const, reason: 'skipped' };

// ?only=failedSends (comma list) computes just those sections; the others come back as
// { available: false, reason: 'skipped' } so a caller like Home doesn't pay for queue counts
// and sync_metadata it never shows.
router.get('/status', async (req: Request, res: Response) => {
  const onlyQ = typeof req.query.only === 'string' ? req.query.only.split(',').map(x => x.trim()) : [];
  const only = new Set<StatusSection>(onlyQ.filter((x): x is StatusSection => (STATUS_SECTIONS as readonly string[]).includes(x)));
  const want = (name: StatusSection) => only.size === 0 || only.has(name);
  const [dataSources, queues, failedSends] = await Promise.all([
    // Same columns DailyReportService.getSyncStatus reads.
    !want('dataSources') ? Promise.resolve(STATUS_SKIPPED) : section('dataSources', async () => {
      // rayna_* rows are left out: the current DailyBillingSync writes the rayna_* tables directly and
      // never updates sync_metadata, so those rows are frozen at a May-2026 error from a retired sync.
      // The billing feed's real freshness comes from the tables themselves (/rayna-sync/mapping-stats).
      const { rows } = await db.query<CountRow>(`SELECT table_name, sync_status, last_synced_at, rows_synced, sync_duration_ms, error_message, updated_at
        FROM sync_metadata WHERE table_name NOT LIKE 'rayna\\_%' ORDER BY table_name LIMIT 200`);
      return {
        sources: rows.map(r => ({
          name: String(r.table_name), status: str(r.sync_status), lastSyncedAt: iso(r.last_synced_at),
          lastRunAt: iso(r.updated_at), rows: num(r.rows_synced), durationMs: num(r.sync_duration_ms), error: str(r.error_message),
        })),
      };
    }),

    !want('queues') ? Promise.resolve(STATUS_SKIPPED) : section('queues', async () => {
      // queueCounts → BullMQ getJobCounts (read-only). Each channel independent.
      const results = await Promise.all(QUEUE_CHANNELS.map(async ch => {
        try {
          const c = await withTimeout(queueCounts(ch), QUEUE_TIMEOUT_MS);
          return {
            channel: ch, available: true as const,
            waiting: num(c.waiting), active: num(c.active), delayed: num(c.delayed),
            completed: num(c.completed), failed: num(c.failed), paused: num(c.paused),
          };
        } catch {
          return { channel: ch, available: false as const };
        }
      }));
      if (results.every(r => !r.available)) throw new Error('queue backend unreachable');
      return { queues: results };
    }),

    !want('failedSends') ? Promise.resolve(STATUS_SKIPPED) : section('failedSends', async () => {
      const { rows } = await db.query<CountRow>(`SELECT * FROM (
        (SELECT 'email' AS channel, id, email AS recipient, error_message AS reason, COALESCE(sent_at, created_at) AS ts, journey_id
           FROM email_send_log WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'
           ORDER BY created_at DESC LIMIT 50)
        UNION ALL
        (SELECT 'whatsapp', id, phone, error, created_at, journey_id
           FROM whatsapp_send_log WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'
           ORDER BY created_at DESC LIMIT 50)
        UNION ALL
        (SELECT 'sms', id, phone, error, COALESCE(failed_at, sent_at), journey_id
           FROM sms_send_log WHERE status = 'failed' AND COALESCE(failed_at, sent_at) >= NOW() - INTERVAL '24 hours'
           ORDER BY COALESCE(failed_at, sent_at) DESC LIMIT 50)
        ) f ORDER BY ts DESC NULLS LAST LIMIT 50`);
      return {
        rows: rows.map(r => ({
          channel: String(r.channel), id: num(r.id), recipient: str(r.recipient), reason: str(r.reason),
          time: iso(r.ts), journeyId: r.journey_id == null ? null : num(r.journey_id),
        })),
      };
    }),
  ]);
  res.json({ dataSources, queues, failedSends });
});

// ── GET /messages ─────────────────────────────────────────────────────────────
const MSG_CHANNELS = ['email', 'whatsapp', 'sms'] as const;
type MsgChannel = typeof MSG_CHANNELS[number];
const MSG_STATUSES = ['queued', 'sent', 'delivered', 'read', 'opened', 'clicked', 'failed', 'blocked', 'simulated'];

// Per-channel column mapping, copied from SendTrackService.getSendLog/getWhatsAppLog.
const MSG_SRC: Record<MsgChannel, { table: string; ts: string; recipient: string; name: string; label: string; error: string; extraSearch: string }> = {
  // created_at, not sent_at: failed/queued emails never get a sent_at, so filtering on it hid them.
  email:    { table: 'email_send_log',    ts: 'created_at',    recipient: 'email', name: 'contact_name', label: 'COALESCE(subject, template_label)', error: 'error_message', extraSearch: 'subject' },
  whatsapp: { table: 'whatsapp_send_log', ts: 'created_at', recipient: 'phone', name: 'contact_name', label: 'template_name',                     error: 'error',         extraSearch: 'template_name' },
  sms:      { table: 'sms_send_log',      ts: 'sent_at',    recipient: 'phone', name: 'contact_name', label: 'message_body',                      error: 'error',         extraSearch: 'message_body' },
};

/** Message-log totals stop counting here; the UI shows "10,000+". */
export const MSG_COUNT_CAP = 10_000;

router.get('/messages', async (req: Request, res: Response) => {
  const chQ = typeof req.query.channel === 'string' ? req.query.channel : '';
  const channels: MsgChannel[] = (MSG_CHANNELS as readonly string[]).includes(chQ) ? [chQ as MsgChannel] : [...MSG_CHANNELS];
  const statusQ = typeof req.query.status === 'string' && MSG_STATUSES.includes(req.query.status) ? req.query.status : null;
  const journeyId = parseId(req.query.journeyId);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const limit = clampInt(req.query.limit, 50, 200);
  const page = clampInt(req.query.page, 1, 200);
  const days = clampInt(req.query.days, 30, 90);
  const offset = (page - 1) * limit;

  // Shared params: $1 days, then optional filters.
  const params: unknown[] = [days];
  const pStatus = statusQ && statusQ !== 'opened' && statusQ !== 'clicked' ? (params.push(statusQ), `$${params.length}`) : null;
  const pJourney = journeyId ? (params.push(journeyId), `$${params.length}`) : null;
  const pQ = q ? (params.push(`%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`), `$${params.length}`) : null;

  const whereFor = (ch: MsgChannel) => {
    const m = MSG_SRC[ch];
    const c = [`${m.ts} >= NOW() - ($1 || ' days')::interval`];
    if (statusQ) {
      if (statusQ === 'opened')       c.push(ch === 'email' ? 'opened_at IS NOT NULL' : ch === 'whatsapp' ? 'read_at IS NOT NULL' : '1 = 0');
      else if (statusQ === 'clicked') c.push(ch === 'email' ? 'clicked_at IS NOT NULL' : '1 = 0');
      else if (pStatus)               c.push(`status = ${pStatus}`);
    }
    if (pJourney) c.push(`journey_id = ${pJourney}`);
    if (pQ) c.push(`(${m.recipient} ILIKE ${pQ} OR ${m.name} ILIKE ${pQ} OR ${m.extraSearch} ILIKE ${pQ})`);
    return c.join(' AND ');
  };

  const listParams = [...params, offset + limit];
  const pTake = `$${listParams.length}`;
  const listParts = channels.map(ch => {
    const m = MSG_SRC[ch];
    const opened = ch === 'email' ? 'opened_at' : ch === 'whatsapp' ? 'read_at' : 'NULL::timestamptz';
    const clicked = ch === 'email' ? 'clicked_at' : 'NULL::timestamptz';
    return `(SELECT '${ch}' AS channel, id, ${m.recipient} AS recipient, ${m.name} AS contact_name,
        LEFT(${m.label}, 200) AS label, status, ${m.error} AS error, journey_id, node_id,
        ${m.ts} AS ts, ${opened} AS opened_at, ${clicked} AS clicked_at
      FROM ${m.table} WHERE ${whereFor(ch)} ORDER BY ${m.ts} DESC NULLS LAST LIMIT ${pTake})`;
  });

  const [list, count] = await Promise.all([
    section('messages', async () => {
      const { rows } = await db.query<CountRow>(`SELECT * FROM (${listParts.join(' UNION ALL ')}) m
        ORDER BY ts DESC NULLS LAST, id DESC LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, limit, offset]);
      return {
        rows: rows.map(r => ({
          channel: String(r.channel), id: num(r.id), recipient: str(r.recipient), contactName: str(r.contact_name),
          label: str(r.label), status: str(r.status), error: str(r.error),
          journeyId: r.journey_id == null ? null : num(r.journey_id), nodeId: str(r.node_id),
          time: iso(r.ts), openedAt: iso(r.opened_at), clickedAt: iso(r.clicked_at),
        })),
      };
    }),
    section('count', async () => {
      // Each channel stops counting at the cap, so a huge log never forces a full exact count.
      const parts = channels.map(ch => `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${MSG_SRC[ch].table} WHERE ${whereFor(ch)} LIMIT ${MSG_COUNT_CAP + 1}) c`);
      const { rows } = await db.query<CountRow>(`SELECT ${parts.map((_, i) => `(${parts[i]})`).join(' + ')} AS total`, params);
      const t = num(rows[0]?.total);
      return { total: Math.min(t, MSG_COUNT_CAP), capped: t > MSG_COUNT_CAP };
    }),
  ]);

  res.json({
    page, limit, days, channel: channels.length === 1 ? channels[0] : 'all',
    messages: list,
    total: count.available ? count.total : null,
    capped: count.available ? count.capped : false,
  });
});

// ── GET /website ──────────────────────────────────────────────────────────────
router.get('/website', async (req: Request, res: Response) => {
  const range = parseRange(req.query.from, req.query.to, 14);
  const p = [range.from, addDays(range.to, 1)];
  const S = dubaiStart('$1'), E = dubaiStart('$2');

  const [eventsPerDay, topEvents, topPages, lastHour, utmLinks] = await Promise.all([
    section('eventsPerDay', async () => {
      const { rows } = await db.query<CountRow>(`SELECT to_char((created_at AT TIME ZONE 'Asia/Dubai')::date, 'YYYY-MM-DD') AS d, COUNT(*) AS n
        FROM gtm_events WHERE created_at >= ${S} AND created_at < ${E} GROUP BY 1 ORDER BY 1 LIMIT 400`, p);
      const byDate = new Map(rows.map(r => [String(r.d), num(r.n)]));
      return { days: Array.from({ length: range.days }, (_, i) => { const date = addDays(range.from, i); return { date, events: byDate.get(date) ?? 0 }; }) };
    }),
    section('topEvents', async () => {
      // GTMService.getEventAnalytics top_events pattern.
      const { rows } = await db.query<CountRow>(`SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT customer_id) AS unique_users
        FROM gtm_events WHERE created_at >= ${S} AND created_at < ${E}
        GROUP BY event_name ORDER BY count DESC LIMIT 20`, p);
      return { events: rows.map(r => ({ name: String(r.event_name), count: num(r.count), uniqueUsers: num(r.unique_users) })) };
    }),
    section('topPages', async () => {
      const { rows } = await db.query<CountRow>(`SELECT page_url, COUNT(*) AS count
        FROM gtm_events WHERE created_at >= ${S} AND created_at < ${E} AND page_url IS NOT NULL AND page_url <> ''
        GROUP BY page_url ORDER BY count DESC LIMIT 20`, p);
      return { pages: rows.map(r => ({ url: String(r.page_url), count: num(r.count) })) };
    }),
    section('lastHour', async () => {
      const { rows } = await db.query<CountRow>(`SELECT COUNT(*) AS n FROM gtm_events WHERE created_at >= NOW() - INTERVAL '1 hour'`);
      return { count: num(rows[0]?.n) };
    }),
    section('utmLinks', async () => {
      // Reuses UTMService.getUserLinkStats (read-only SELECTs over user_utm_links + campaigns). Not date-filtered.
      const { campaigns, totals } = await UTMService.getUserLinkStats();
      return {
        totals: {
          links: num(totals?.total_links), clickedLinks: num(totals?.total_clicked), clicks: num(totals?.total_clicks),
          campaigns: num(totals?.campaigns), uniqueUsers: num(totals?.unique_users),
        },
        campaigns: campaigns.slice(0, 20).map(c => ({
          campaignId: num(c.campaign_id), name: str(c.campaign_name), segment: str(c.segment_label), channel: str(c.channel),
          links: num(c.total_links), clickedLinks: num(c.clicked), clicks: num(c.total_clicks), lastClick: iso(c.last_click),
        })),
      };
    }),
  ]);
  res.json({ range, eventsPerDay, topEvents, topPages, lastHour, utmLinks });
});

// Warm the slowest Home cards shortly after the server starts, so the first visitor
// usually finds them ready. Read-only (the same SELECTs a page load would run); skipped in tests.
if (process.env.NODE_ENV !== 'test' && process.env.OVERVIEW_PREWARM !== 'false') {
  setTimeout(() => {
    for (const name of ['series14d', 'sendingToday', 'delivery7d'] as const) {
      void getHomeSection(name).catch(() => { /* a later page load will retry */ });
    }
  }, 15_000).unref();
}

export default router;
