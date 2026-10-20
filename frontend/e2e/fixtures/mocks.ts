import { campaignAnalytics, contacts, journeyDetail, journeys, sendLogRows, unifiedStats } from './data';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface Mock {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Matched against pathname + search, e.g. /^\/api\/v2\/strategies(\?|$)/ */
  path: RegExp;
  status?: number;
  body: Json | ((url: URL, postData: string | null) => Json);
}

const ok = (data: Json): Json => ({ success: true, data });
/** Exact API path, optionally followed by a query string. */
const p = (path: string): RegExp => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?.*)?$`);
const get = (path: string, body: Json | Mock['body']): Mock => ({ method: 'GET', path: p(path), body });

export const SEND_LOG_TOTAL = 45;

/** Home overview sections, served both together (/home) and one per path (/home/:section). */
const homeSections: { [section: string]: Json } = {
  sentToday: { available: true, email: 120, whatsapp: 40, sms: 5, total: 165 },
  delivery7d: { available: true, sent: 900, delivered: 870, deliveredPct: 96.7 },
  conversions30d: { available: true, count: 12 },
  runningJourneys: { available: true, journeys: [{ id: 11, name: 'Welcome series', status: 'active', joined: 340 }] },
  sendingToday: { available: true, journeys: [{ id: 11, name: 'Welcome series', due: 25 }], total: 25 },
  series14d: { available: true, days: [{ date: '2026-10-18', email: 100, whatsapp: 30, sms: 2, total: 132 }, { date: '2026-10-19', email: 120, whatsapp: 40, sms: 5, total: 165 }] },
};

/**
 * Default fixtures for every API path the app calls on page load. Anything not listed here
 * is reported as "unmocked" and fails the test (see fixtures/test.ts).
 */
export const defaultMocks: Mock[] = [
  // ── Auth ──
  { method: 'POST', path: p('/api/auth/logout'), body: ok(null) },

  // ── Overview (read-only /api/v3/overview/*) ──
  get('/api/v3/overview/home', homeSections),
  // Per-card endpoints the Home page calls (one request per section).
  ...Object.entries(homeSections).map(([name, body]) => get(`/api/v3/overview/home/${name}`, body)),
  get('/api/v3/overview/status', {
    dataSources: { available: true, sources: [{ name: 'rayna_tours', status: 'success', lastSyncedAt: '2026-10-19T04:30:00Z', lastRunAt: '2026-10-19T04:30:00Z', rows: 1200, durationMs: 5400, error: null }] },
    queues: { available: true, queues: [{ channel: 'email', available: true, waiting: 3, active: 1, delayed: 0, completed: 500, failed: 0, paused: 0 }] },
    failedSends: { available: true, rows: [] },
  }),
  get('/api/v3/overview/insights', {
    range: { from: '2026-09-20', to: '2026-10-19', days: 30 },
    totals: { available: true, sent: 1000, delivered: 950, opened: 400, clicked: 80, unsubscribed: 3 },
    previous: { available: true, from: '2026-08-21', to: '2026-09-19', sent: 900, delivered: 860, opened: 350, clicked: 70, unsubscribed: 4 },
    weeklyTrend: { available: true, weeks: [{ week: '2026-10-13', sent: 250, opened: 100, clicked: 20, openRate: 40, clickRate: 8 }] },
    funnel: { available: true, channel: 'email', sent: 1000, opened: 400, clicked: 80, converted: 10 },
    journeys: { available: true, rows: [{ id: 11, name: 'Welcome series', status: 'active', sent: 1000, opened: 400, clicked: 80, unsubscribed: 3, openRate: 40, clickRate: 8 }] },
  }),
  get('/api/v3/overview/messages', { page: 1, limit: 20, days: 30, channel: 'all', messages: { available: true, rows: [] }, total: 0 }),
  get('/api/v3/overview/website', {
    range: { from: '2026-10-06', to: '2026-10-19', days: 14 },
    eventsPerDay: { available: true, days: [{ date: '2026-10-19', events: 42 }] },
    topEvents: { available: true, events: [{ name: 'page_view', count: 42, uniqueUsers: 20 }] },
    topPages: { available: true, pages: [{ url: 'https://www.raynatours.com/', count: 30 }] },
    lastHour: { available: true, count: 4 },
    utmLinks: { available: true, totals: { links: 5, clickedLinks: 2, clicks: 9, campaigns: 1, uniqueUsers: 6 }, campaigns: [] },
  }),

  // ── Dashboard ──
  get('/api/v3/unified-contacts/sources-breakdown', ok({ from: null, to: null, total: 1250, sources: [{ source: 'chat', count: 700 }, { source: 'booking', count: 550 }] })),
  get('/api/v3/unified-contacts/stats', ok(unifiedStats)),
  get('/api/v2/campaigns', ok([])),
  get('/api/v3/unified-contacts/segmentation-tree', ok([])),
  get('/api/v3/unified-contacts/segment-activity', ok([])),
  get('/api/v3/unified-contacts/segment-changes', ok([])),

  // ── Segmentation ──
  get('/api/v3/segments/general', ok([])),
  get('/api/v3/custom-segments', ok([])),
  // Send a message wizard (/sends/new) reads the v3 funnel for its segment list.
  get('/api/v3/segments/funnel', ok([{ stage_name: 'Awareness', stage_color: '#C9A96E', segments: [{ segment_id: 1, segment_name: 'New Leads', customer_count: 120 }] }])),
  { method: 'POST', path: p('/api/v3/custom-segments/preview-count'), body: { success: true, count: 42 } },
  { method: 'POST', path: p('/api/v3/custom-segments'), body: ok({ id: 900 }) },

  // ── Contacts ──
  get('/api/v3/unified-contacts', (url) => {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const rows = q ? contacts.filter((c) => JSON.stringify(c).toLowerCase().includes(q)) : contacts;
    return { success: true, data: rows, total: rows.length, totalPages: 1 };
  }),
  get('/api/v3/unified-contacts/filters', ok({ countries: ['UAE', 'India', 'Spain'], contactTypes: [], sources: [], bookingStatuses: [], productTiers: [], geographies: [] })),

  // ── Affinity ──
  // Bare objects, no envelope.
  get('/api/v3/booking-affinity/summary', { status: 'ready', builtAt: '2026-10-19T00:30:00.000Z', lastError: null, totalCustomers: 1, topService: [{ service: 'tours', customers: 1 }] }),
  get('/api/v3/booking-affinity/customers', { total: 1, customers: [{ unified_id: 101, name: 'Aisha Khan', email: 'aisha@example.com', country: 'UAE', contact_type: 'B2C', is_bulk: false, bookings: 3, bookings_all: 3, last_booking_date: '2026-09-01', affinity_score: 8.5, service_1: 'tours' }] }),

  // ── Journeys ──
  get('/api/v3/journeys', { success: true, data: journeys, total: journeys.length }),
  get('/api/v3/journeys/dashboard', ok({
    generatedAt: '2026-10-19T06:00:00.000Z',
    kpis: { activeJourneys: 1, activeEntries: 200, sendsToday: 35, sendsTomorrow: 40, queuedNow: 3, openRate7d: 41.5, conversions7d: 4 },
    forecast: [], forecastChart: [], forecastJourneyNames: [], runningNow: [], engagement: [],
    journeys: [], health: { aiFallback: [], stuckEntries: [] },
  })),
  get('/api/v3/journeys/analytics/table', ok([])),
  get('/api/v3/journeys/queue-counts', ok({})),
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+(\?.*)?$/, body: ok(journeyDetail) },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/entries(\?.*)?$/, body: { success: true, data: [], total: 0 } },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/timeline(\?.*)?$/, body: ok([]) },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/campaign-analytics(\?.*)?$/, body: ok(campaignAnalytics) },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/analytics(\?.*)?$/, body: ok({ nodeStats: [], funnelData: [{ current_node_id: 'n2', status: 'active', count: '20' }] }) },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/node-conversions(\?.*)?$/, body: ok({}) },
  { method: 'GET', path: /^\/api\/v3\/journeys\/\d+\/gtm-node-stats(\?.*)?$/, body: { success: true, data: {}, allEventTypes: [] } },

  // ── Content ──
  get('/api/v3/test-sends/send-log/summary', ok({})),
  get('/api/v3/test-sends/utm-log', ok({ rows: [], total: 0 })),
  get('/api/v3/test-sends/utm-log/summary', ok({ byCampaign: [], bySource: [] })),
  get('/api/v3/test-sends/contacts', { success: true, data: [], total: 0 }),
  get('/api/v2/content/templates', { success: true, data: [], total: 0 }),
  get('/api/v3/chathead/channels', ok([])),
  get('/api/v3/gupshup/sms/config', ok({})),
  get('/api/v3/gupshup/sms/templates', ok([])),
  get('/api/v3/gupshup/rcs/config', ok({})),
  get('/api/v3/gupshup/rcs/templates', ok([])),

  // ── Send log ──
  get('/api/v3/test-sends/send-log', (url) => {
    const page = Number(url.searchParams.get('page') || '1');
    const limit = Number(url.searchParams.get('limit') || '20');
    const status = url.searchParams.get('status');
    const total = status ? 3 : SEND_LOG_TOTAL;
    return ok({ rows: sendLogRows(page, limit, status, total), total, page, limit, estimated: false });
  }),

  // ── UTM ──
  get('/api/v3/utm/analytics', ok({ links: [], summary: [], segmentSummary: [] })),
  get('/api/v3/utm/segments', ok([{ segment_name: 'New Leads', customer_count: 120, utm_count: '0' }])),

  // ── Tag manager ──
  get('/api/v3/gtm/snippet', ok({})),
  get('/api/v3/gtm/datalayer', ok({})),
  get('/api/v3/gtm/analytics', ok({})),
  get('/api/v3/gtm/occasions', ok([])),

  // ── Data pipeline ──
  get('/api/v3/rayna-sync/status', ok({})),
  get('/api/v3/rayna-sync/mapping-stats', ok({})),

  // ── Leads ──
  // The leads endpoints return bare objects (no { success, data } envelope).
  get('/api/v3/chat-leads/summary', (url) => ({ from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', totalChats: 14, totalLeads: 9, newUsers: 5, oldUsers: 4 })),
  get('/api/v3/chat-leads/trend', { points: [] }),
  get('/api/v3/chat-leads/department-periods', { periods: [], rows: [] }),
  get('/api/v3/chat-leads/groups', ok([])),
];
