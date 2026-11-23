/**
 * JourneyAnalyticsTableService — READ-ONLY paging over the precomputed journey_node_stats
 * rollup (the '__ALL__' summary row of each journey) for the Performance page's
 * "Your journeys" table.
 *
 * SELECT only. Every user value is a bind parameter; the sort column/direction come from a
 * fixed whitelist, never from the request text. LIMIT/OFFSET are clamped integers.
 */
import db from '../config/database.js';
import { clampInt, MAX_PAGE } from '../utils/validate.js';

export const ANALYTICS_TABLE_DEFAULT_LIMIT = 20;
export const ANALYTICS_TABLE_MAX_LIMIT = 200;
const MAX_SEARCH_LEN = 100;

/** Rate expressions guard against divide-by-zero; NULL-safe so sorting never errors. */
const OPEN_DEN = 'NULLIF(COALESCE(NULLIF(s.delivered, 0), s.sent), 0)';
const SORTS: Record<string, string> = {
  entries: 'COALESCE(s.entries, 0)',
  sent: 'COALESCE(s.sent, 0)',
  delivered: 'COALESCE(s.delivered, 0)',
  opened: 'COALESCE(s.opened, 0)',
  clicked: 'COALESCE(s.clicked, 0)',
  unsubscribed: 'COALESCE(s.unsubscribed, 0)',
  booked: 'COALESCE(s.booked, 0)',
  openRate: `COALESCE(s.opened::numeric / ${OPEN_DEN}, 0)`,
  clickRate: 'COALESCE(s.clicked::numeric / NULLIF(s.opened, 0), 0)',
  name: 'LOWER(COALESCE(s.journey_name, \'\'))',
};
export const ANALYTICS_TABLE_SORTS = Object.keys(SORTS);

export interface AnalyticsTableQuery {
  status?: unknown;
  type?: unknown;
  search?: unknown;
  sort?: unknown;
  dir?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface AnalyticsTablePage<Row> {
  journeys: Row[];
  total: number;
  page: number;
  limit: number;
  sort: string;
  dir: 'asc' | 'desc';
}

/** True when the request carries any of the optional paging/search/sort params. */
export function wantsPaging(q: AnalyticsTableQuery): boolean {
  return ['page', 'limit', 'search', 'sort', 'dir', 'type'].some(k => {
    const v = q[k as keyof AnalyticsTableQuery];
    return v !== undefined && v !== '';
  });
}

/** Escape LIKE wildcards so a search for "50%" matches the text literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}

export function buildAnalyticsTableQuery(q: AnalyticsTableQuery) {
  const params: unknown[] = [];
  const where = [`s.node_id = '__ALL__'`];
  if (typeof q.status === 'string' && q.status) {
    params.push(q.status);
    where.push(`s.journey_status = $${params.length}`);
  }
  if (q.type === 'continuous') where.push(`COALESCE(jf.journey_type, 'normal') = 'gtm'`);
  else if (q.type === 'fixed') where.push(`COALESCE(jf.journey_type, 'normal') <> 'gtm'`);
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, MAX_SEARCH_LEN) : '';
  if (search) {
    params.push(`%${likeEscape(search)}%`);
    const p = `$${params.length}`;
    where.push(`(COALESCE(s.journey_name, '') ILIKE ${p} OR ('#' || s.journey_id::text) ILIKE ${p})`);
  }
  const sort = typeof q.sort === 'string' && Object.hasOwn(SORTS, q.sort) ? q.sort : 'entries';
  const dir: 'asc' | 'desc' = q.dir === 'asc' ? 'asc' : 'desc';
  const limit = clampInt(q.limit, ANALYTICS_TABLE_DEFAULT_LIMIT, ANALYTICS_TABLE_MAX_LIMIT);
  const page = clampInt(q.page, 1, MAX_PAGE);
  const from = `FROM journey_node_stats s LEFT JOIN journey_flows jf ON jf.journey_id = s.journey_id WHERE ${where.join(' AND ')}`;
  const countSql = `SELECT COUNT(*)::int AS total ${from}`;
  const countParams = [...params];
  params.push(limit, (page - 1) * limit);
  const rowsSql =
    `SELECT s.*, COALESCE(jf.journey_type, 'normal') AS journey_type ${from} ` +
    `ORDER BY ${SORTS[sort]} ${dir.toUpperCase()}, s.journey_id DESC ` +
    `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return { rowsSql, rowsParams: params, countSql, countParams, page, limit, sort, dir };
}

export async function getAnalyticsTablePage<Row extends Record<string, unknown>>(q: AnalyticsTableQuery): Promise<AnalyticsTablePage<Row>> {
  const b = buildAnalyticsTableQuery(q);
  const { rows } = await db.query<Row>(b.rowsSql, b.rowsParams);
  const { rows: [c] } = await db.query<{ total: number | string }>(b.countSql, b.countParams);
  const total = Number(c?.total);
  return { journeys: rows, total: Number.isFinite(total) ? total : 0, page: b.page, limit: b.limit, sort: b.sort, dir: b.dir };
}

export default { getAnalyticsTablePage, buildAnalyticsTableQuery, wantsPaging };
