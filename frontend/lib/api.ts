import type {
  Id, QueryParams, JsonBody, ApiEnvelope, AuthData,
  UnifiedStats, SourcesBreakdown, SendLogPage, GiveawayLog,
} from '@/types/api';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const AUTH_KEY = 'rayna-auth';

function getAuth(): AuthData | null {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null') as AuthData | null; } catch { return null; }
}
function setAuth(a: AuthData): void {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}
function getToken(): string | null {
  return getAuth()?.token || null;
}
function clearAuthAndRedirect(): void {
  try { localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
  if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

// Same output as `new URLSearchParams(params).toString()`: URLSearchParams calls String() on
// every value at runtime; TypeScript just wants that conversion spelled out.
function toQuery(params: QueryParams | [string, unknown][] = {}): string {
  const entries = Array.isArray(params) ? params : Object.entries(params);
  return new URLSearchParams(entries.map(([k, v]): [string, string] => [k, String(v)])).toString();
}

interface RefreshResponse {
  data?: { token?: string; refreshToken?: string; user?: AuthData['user'] };
}

// Exchange the refresh token for a new access token. De-duped so many concurrent 401s
// trigger only ONE refresh call. Returns the new access token, or null if refresh failed.
let _refreshPromise: Promise<string | null> | null = null;
function tryRefresh(): Promise<string | null> {
  const auth = getAuth();
  if (!auth?.refreshToken) return Promise.resolve(null);
  if (!_refreshPromise) {
    _refreshPromise = fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    })
      .then(r => (r.ok ? (r.json() as Promise<RefreshResponse>) : null))
      .then(d => {
        const data = d?.data;
        if (!data?.token) return null;
        setAuth({ ...auth, token: data.token, refreshToken: data.refreshToken || auth.refreshToken, user: data.user || auth.user });
        return data.token;
      })
      .catch(() => null)
      .finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

type RequestOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

// fetch() that sends the access token and, on a 401, refreshes it once and retries.
// Returns the raw Response; if the session can't be restored it redirects to /login.
export async function authFetch(url: string, options: RequestOptions = {}, _retried = false): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status !== 401) return res;

  // Don't refresh for auth endpoints themselves (avoids a refresh loop).
  if (!_retried && !url.includes('/api/auth/')) {
    const newToken = await tryRefresh();
    if (newToken) return authFetch(url, options, true);
  }
  clearAuthAndRedirect();
  return res;
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await authFetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (res.status === 401) throw new Error('Session expired. Please log in again.');

  // 204s and HTML error pages (502 from a proxy) aren't JSON — don't turn them into
  // a confusing 'Unexpected token <' error.
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // same as the old `data?.error || \`HTTP ${status}\`` — an empty/null error falls back
    const errorValue = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined;
    throw new Error(errorValue ? String(errorValue) : `HTTP ${res.status}`);
  }
  return data as T;
}

/** Triggers a browser download of a Blob under the given file name. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Strategies ──────────────────────────────────────────────
export const getStrategies = () => request('/api/v2/strategies');
export const getStrategy = (id: Id) => request(`/api/v2/strategies/${id}`);
export const createStrategy = (data: JsonBody) => request('/api/v2/strategies', { method: 'POST', body: JSON.stringify(data) });
export const updateStrategy = (id: Id, data: JsonBody) => request(`/api/v2/strategies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const optimizeStrategy = (id: Id) => request(`/api/v2/strategies/${id}/optimize`, { method: 'POST' });

// ── Content Templates ───────────────────────────────────────
export const getTemplates = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v2/content/templates?${qs}`);
};
export const getTemplate = (id: Id) => request(`/api/v2/content/templates/${id}`);
export const previewTemplate = (id: Id, variables: Record<string, unknown> = {}) =>
  request(`/api/v2/content/templates/${id}/preview`, {
    method: 'POST',
    body: JSON.stringify({ variables }),
  });
export const previewTemplateAI = (id: Id) => request(`/api/v2/content/templates/${id}/preview-ai`);
// Render arbitrary HTML through the server's Liquid + sample-vars pipeline.
// Used by the Edit modal so the live preview matches what users will see.
export const renderPreviewHtml = (html: string, { engine = 'liquid', variables = {} }: { engine?: string; variables?: Record<string, unknown> } = {}) =>
  request('/api/v2/content/preview/render', {
    method: 'POST',
    body: JSON.stringify({ html, engine, variables }),
  });
export const createTemplate = (data: JsonBody) => request('/api/v2/content/templates', { method: 'POST', body: JSON.stringify(data) });
export const updateTemplate = (id: Id, data: JsonBody) => request(`/api/v2/content/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTemplate = (id: Id) => request(`/api/v2/content/templates/${id}`, { method: 'DELETE' });
export const approveTemplate = (id: Id) => request(`/api/v2/content/templates/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy: 'admin' }) });
export const rejectTemplate = (id: Id) => request(`/api/v2/content/templates/${id}/reject`, { method: 'POST' });
export const generateContent = (data: JsonBody) => request('/api/v2/content/generate', { method: 'POST', body: JSON.stringify(data) });

// HTML email templates
export const getHtmlTemplates = () => request('/api/v2/content/html-templates');
export const previewHtmlEmail = (id: Id) => request(`/api/v2/content/preview-html/${id}`);
export const renderEmailForUser = (id: Id, data: JsonBody) => request(`/api/v2/content/render/${id}`, { method: 'POST', body: JSON.stringify(data) });

// ── Campaigns ───────────────────────────────────────────────
export const getCampaigns = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v2/campaigns?${qs}`);
};
export const getCampaign = (id: Id) => request(`/api/v2/campaigns/${id}`);
export const createCampaign = (data: JsonBody) => request('/api/v2/campaigns', { method: 'POST', body: JSON.stringify(data) });
export const executeCampaign = (id: Id) => request(`/api/v2/campaigns/${id}/execute`, { method: 'POST' });
export const processQueue = (batch = 100) => request(`/api/v2/campaigns/process-queue?batch=${batch}`, { method: 'POST' });
export const getCampaignPerformance = () => request('/api/v2/campaigns/performance');

// ── Health ──────────────────────────────────────────────────
export const healthCheck = () => request('/api/health');

// ══════════════════════════════════════════════════════════════
// V3 API — 28-Segment Engine, Journeys, Funnel, AI Agents
// ══════════════════════════════════════════════════════════════

interface FunnelStage {
  stage_name?: string;
  stage_color?: string;
  segments?: Record<string, unknown>[];
}

// ── Segments v3 (28 segments, 7 funnel stages) ──────────────
export const getSegments = async () => {
  const res = await getFunnelOverview();
  const segments = (res.data || []).flatMap(stage =>
    (stage.segments || []).map(s => ({ ...s, stage_name: stage.stage_name, stage_color: stage.stage_color }))
  );
  return segments;
};
export const getFunnelOverview = () => request<{ data?: FunnelStage[] }>('/api/v3/segments/funnel');
export const getSegmentSummary = () => request('/api/v3/segments/summary');
export const runSegmentation = () => request('/api/v3/segments/run', { method: 'POST' });
export const getSegmentV3 = (id: Id) => request(`/api/v3/segments/${id}`);
export const getSegmentV3Customers = (id: Id, params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/segments/${id}/customers?${qs}`);
};
export const getSegmentConversions = (id: Id) => request(`/api/v3/segments/${id}/conversions`);

// ── Journeys (Flow Builder) ─────────────────────────────────
export const getJourneys = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/journeys?${qs}`);
};
export const getJourneyOpsDashboard = () => request('/api/v3/journeys/dashboard');
// Analytics tab — reads the precomputed journey_node_stats rollup (fast; never scans live)
export type JourneyAnalyticsSort = 'entries' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'unsubscribed' | 'booked' | 'openRate' | 'clickRate' | 'name';
/** Optional server-side paging for the analytics table. Omit it to get the original full list. */
export interface JourneyAnalyticsTableOptions {
  page?: number; limit?: number; search?: string; sort?: JourneyAnalyticsSort; dir?: 'asc' | 'desc'; type?: 'fixed' | 'continuous';
}
export const getJourneyAnalyticsTable = (status?: string, opts?: JourneyAnalyticsTableOptions) => {
  if (!opts) return request(`/api/v3/journeys/analytics/table${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  return request(`/api/v3/journeys/analytics/table${overviewQs({ status, ...opts })}`);
};
export const getJourneyAnalyticsNodes = (id: Id, date?: string) => request(`/api/v3/journeys/analytics/${id}/nodes${date ? `?date=${date}` : ''}`);
export const refreshJourneyAnalytics  = (id: Id) => request(`/api/v3/journeys/analytics/${id}/refresh`, { method: 'POST' });
export const regenerateJourneyQaReports = () => request('/api/v3/journeys/analytics/regenerate-qa', { method: 'POST' });
export const getJourney = (id: Id) => request(`/api/v3/journeys/${id}`);
export const createJourney = (data: JsonBody) => request('/api/v3/journeys', { method: 'POST', body: JSON.stringify(data) });
// Progress of the background audience build kicked off by createJourney — 'building' | 'done' | 'failed'.
export const getJourneySnapshotStatus = (id: Id) => request(`/api/v3/journeys/${id}/snapshot-status`);
export const updateJourney = (id: Id, data: JsonBody) => request(`/api/v3/journeys/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteJourney = (id: Id) => request(`/api/v3/journeys/${id}`, { method: 'DELETE' });
export const generateJourneyFromStrategy = (strategyId: Id) => request(`/api/v3/journeys/generate-from-strategy/${strategyId}`, { method: 'POST' });
export const enrollJourney = (id: Id) => request(`/api/v3/journeys/${id}/enroll`, { method: 'POST' });
export const processJourney = (id: Id) => request(`/api/v3/journeys/${id}/process`, { method: 'POST' });
export const startJourney = (id: Id) => request(`/api/v3/journeys/${id}/start`, { method: 'POST' });
export const pauseJourney = (id: Id) => request(`/api/v3/journeys/${id}/pause`, { method: 'POST' });
export const getJourneyEntries = (id: Id, params: QueryParams = {}) => { const qs = toQuery(params); return request(`/api/v3/journeys/${id}/entries?${qs}`); };
export const getJourneyAnalytics = (id: Id) => request(`/api/v3/journeys/${id}/analytics`);
export const getJourneyCampaignAnalytics = (id: Id) => request(`/api/v3/journeys/${id}/campaign-analytics`);
export const getJourneyGtmNodeStats    = (id: Id) => request(`/api/v3/journeys/${id}/gtm-node-stats`);
export const getJourneyNodeConversions = (id: Id) => request(`/api/v3/journeys/${id}/node-conversions`);
export const previewJourneyNodeEmail   = (id: Id, nodeId: string) => request(`/api/v3/journeys/${id}/nodes/${nodeId}/preview-dynamic`);
export const getJourneyNodeBreakdown   = (id: Id, date?: string) => request(`/api/v3/journeys/${id}/node-breakdown${date ? `?date=${date}` : ''}`);
export const getJourneysActiveOnDate   = (date?: string) => request(`/api/v3/journeys/active-on-date${date ? `?date=${date}` : ''}`);
export const checkJourneyConversions = (id: Id) => request(`/api/v3/journeys/${id}/check-conversions`, { method: 'POST' });
export const getJourneyEnrollments = (id: Id) => request(`/api/v3/journeys/${id}/enrollments`);
// Node-level CRUD inside a journey
export const addJourneyNode = (id: Id, node: JsonBody, afterNodeId: string | null = null) =>
  request(`/api/v3/journeys/${id}/nodes`, { method: 'POST', body: JSON.stringify({ node, afterNodeId }) });
export const updateJourneyNode = (id: Id, nodeId: string, patch: JsonBody) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteJourneyNode = (id: Id, nodeId: string) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}`, { method: 'DELETE' });
export const testSendJourneyNode = (id: Id, nodeId: string, recipient: JsonBody) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/test`, { method: 'POST', body: JSON.stringify({ recipient }) });

export const testSendJourneyNodeBatch = (id: Id, nodeId: string, recipients: JsonBody) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/test-batch`, { method: 'POST', body: JSON.stringify({ recipients }) });

export const bulkTestJourneyNode = (id: Id, nodeId: string, email: string, count: number) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/bulk-test`, { method: 'POST', body: JSON.stringify({ email, count }) });

export const segmentTestJourneyNode = (id: Id, nodeId: string, testEmail: string, limit: number) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/segment-test`, { method: 'POST', body: JSON.stringify({ testEmail, limit }) });

export const getNodeSendLog = (id: Id, nodeId: string) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/send-log`);
export const getJourneyQueueCounts = () => request('/api/v3/journeys/queue-counts');
export const retryBlockedEntries = (id: Id, nodeId: string) =>
  request(`/api/v3/journeys/${id}/nodes/${nodeId}/retry-blocked`, { method: 'POST' });
export const getJourneyTimeline = (id: Id) => request(`/api/v3/journeys/${id}/timeline`);

// ── AI Agents ───────────────────────────────────────────────
export const aiCopywrite = (data: JsonBody) => request('/api/v3/agents/copywriter/generate', { method: 'POST', body: JSON.stringify(data) });
export const aiSegmentAnalysis = () => request('/api/v3/agents/segment-assist/analyze');
export const aiFlowSuggest = (journeyId: Id) => request(`/api/v3/agents/flow-assist/suggest/${journeyId}`);
export const aiFlowOptimize = (journeyId: Id) => request(`/api/v3/agents/flow-assist/auto-optimize/${journeyId}`, { method: 'POST' });
export const aiInsights = () => request('/api/v3/agents/insights');
export const aiAutoOptimize = () => request('/api/v3/agents/auto-optimize', { method: 'POST' });
export const getAgentLogs = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/agents/logs?${qs}`);
};

// ── UTM Tracking ──────────────────────────────────────────────
export const buildUTM = (data: JsonBody) => request('/api/v3/utm/build', { method: 'POST', body: JSON.stringify(data) });
export const getUTMSegments = () => request('/api/v3/utm/segments');
export const generateSegmentUTM = (label: string) => request(`/api/v3/utm/segment/${encodeURIComponent(label)}`, { method: 'POST' });
export const generateAllUTM = () => request('/api/v3/utm/generate-all', { method: 'POST' });
export const generateCampaignUTM = (id: Id) => request(`/api/v3/utm/campaign/${id}`, { method: 'POST' });
export const getUTMAnalytics = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/utm/analytics?${qs}`);
};
export const recordUTMClick = (id: Id) => request(`/api/v3/utm/${id}/click`, { method: 'POST' });
export const recordUTMConversion = (id: Id, revenue: number) => request(`/api/v3/utm/${id}/conversion`, { method: 'POST', body: JSON.stringify({ revenue }) });

// ── Per-User UTM Links ──────────────────────────────────────────
export const generateUserLinks = (campaignId: Id, data: JsonBody = {}) => request(`/api/v3/utm/user-links/${campaignId}`, { method: 'POST', body: JSON.stringify(data) });
export const getUserLinks = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/utm/user-links?${qs}`);
};
export const getUserLinkStats = () => request('/api/v3/utm/user-links-stats');

// ── GTM & BigQuery ────────────────────────────────────────────
export const getGTMSnippet = (containerId?: string) => request(`/api/v3/gtm/snippet?containerId=${containerId || ''}`);
export const getDataLayerScripts = () => request('/api/v3/gtm/datalayer');
export const recordGTMEvent = (data: JsonBody) => request('/api/v3/gtm/events', { method: 'POST', body: JSON.stringify(data) });
export const getGTMAnalytics = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/gtm/analytics?${qs}`);
};
export const getGTMEventDetail = (eventName: string) => request(`/api/v3/gtm/events/${encodeURIComponent(eventName)}`);
export const getContactGTMEvents = (unifiedId: Id) => request(`/api/v3/gtm/contact/${unifiedId}`);
export const getGTMExport = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/gtm/export?${qs}`);
};
export const getSpecialOccasions = () => request('/api/v3/gtm/occasions');
export const createSpecialOccasion = (data: JsonBody) => request('/api/v3/gtm/occasions', { method: 'POST', body: JSON.stringify(data) });

// ── Products (Real Rayna Tours Catalog) ──────────────────────
export const getProducts = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/products?${qs}`);
};
export const getProductCategories = () => request('/api/v3/products/categories');
export const getProduct = (id: Id) => request(`/api/v3/products/${id}`);
export const getSegmentProducts = (label: string, limit = 3) => request(`/api/v3/products/segment/${encodeURIComponent(label)}?limit=${limit}`);
export const generateProductEmail = (data: JsonBody) => request('/api/v3/products/generate-email', { method: 'POST', body: JSON.stringify(data) });
export const generateProductWA = (data: JsonBody) => request('/api/v3/products/generate-wa', { method: 'POST', body: JSON.stringify(data) });
export const generateContentWithProducts = (data: JsonBody) => request('/api/v2/content/generate-with-products', { method: 'POST', body: JSON.stringify(data) });

// ── Base Email Templates (Production Rayna Tours) ────────────
export const getBaseTemplates = () => request('/api/v3/base-templates');
export const getBaseTemplate = (id: Id) => request(`/api/v3/base-templates/${id}`);
export const previewBaseTemplate = (id: Id) => request(`/api/v3/base-templates/${id}/preview`);
export const renderBaseTemplate = (id: Id, data: JsonBody) => request(`/api/v3/base-templates/${id}/render`, { method: 'POST', body: JSON.stringify(data) });
export const useBaseTemplate = (id: Id, data: JsonBody) => request(`/api/v3/base-templates/${id}/use`, { method: 'POST', body: JSON.stringify(data) });
export const getSegmentEmailTemplates = () => request('/api/v3/base-templates/segments/all');
export const previewSegmentEmail = (name: string) => request(`/api/v3/base-templates/segments/${encodeURIComponent(name)}/preview`);
export const useSegmentEmail = (name: string, data: JsonBody) => request(`/api/v3/base-templates/segments/${encodeURIComponent(name)}/use`, { method: 'POST', body: JSON.stringify(data) });

// ── Product Affinity ─────────────────────────────────────────
export const getAffinityAll = () => request('/api/v3/affinity');
export const getSegmentAffinity = (id: Id) => request(`/api/v3/affinity/segment/${id}`);
export const getAffinityWhat = (id: Id) => request(`/api/v3/affinity/segment/${id}/what`);
export const getAffinityWhen = (id: Id) => request(`/api/v3/affinity/segment/${id}/when`);
export const getAffinityHow = (id: Id) => request(`/api/v3/affinity/segment/${id}/how`);
export const getAffinityStats = () => request('/api/v3/affinity/stats');
export const getAffinityMatrix = () => request('/api/v3/affinity/matrix');
export const getDepartmentMap = () => request('/api/v3/affinity/departments');

// ── Data Pipeline (Rayna Sync + MySQL Sync + Mapping) ───────
export const getRaynaSyncStatus = () => request('/api/v3/rayna-sync/status');

export type PipelineSource = 'tours' | 'hotels' | 'visas' | 'flights' | 'packages' | 'others';
export interface PipelineCoverage { total: number; mapped: number; lastDataAt: string | null }
export interface PipelineJobMeta {
  sync_status?: string | null; error_message?: string | null; rows_synced?: number | null;
  sync_duration_ms?: number | null; last_synced_at?: string | null;
}
export interface PipelineJob {
  name: string; label: string; category?: 'ingest' | 'compute' | 'engine'; schedule: string; humanSchedule: string;
  description?: string; meta?: PipelineJobMeta | null; nextRun?: string | null; sourceLatestAt?: string | null; sourceLabel?: string;
}
/** /rayna-sync/mapping-stats. Every section is optional: the page hides what the server did not report. */
export interface MappingStats {
  overall?: { totalMapped?: number; customersWithBookings?: number; totalCustomers?: number; matchRate?: number | string };
  coverage?: Partial<Record<PipelineSource, PipelineCoverage>>;
  dataOverview?: Partial<Record<string, number>>;
  mysqlStatus?: { table_name: string; rows_synced?: number | null; sync_duration_ms?: number | null; last_synced_at?: string | null }[];
  cronJobs?: PipelineJob[];
  computedAt?: string;
  cached?: boolean;
  stale?: boolean;
}
/** `fresh` bypasses the server's 60s cache (the Refresh button). */
export const getMappingStats = (params: QueryParams = {}, opts: { fresh?: boolean } = {}) => {
  const qs = toQuery(opts.fresh ? { ...params, fresh: 1 } : params);
  return request<MappingStats>(`/api/v3/rayna-sync/mapping-stats${qs ? `?${qs}` : ''}`);
};
export const triggerRaynaSync = () => request('/api/v3/rayna-sync/trigger', { method: 'POST' });
export const triggerRaynaSyncEndpoint = (ep: string) => request(`/api/v3/rayna-sync/trigger/${ep}`, { method: 'POST' });
export const refreshBookingMapping = () => request('/api/v3/rayna-sync/refresh-mapping', { method: 'POST' });

// ── V3 Migrations ───────────────────────────────────────────
export const runV3MigrateAll = () => request('/api/v3/migrate-all', { method: 'POST' });

// ── Booking Affinity (top 3 services / products per customer) ─
const affinityQs = (params: QueryParams = {}) => toQuery(Object.entries(params).filter(([, value]) => value !== '' && value != null));
export const getAffinitySummary = (params: QueryParams = {}) => request(`/api/v3/booking-affinity/summary?${affinityQs(params)}`);
export const getAffinityTopProducts = (params: QueryParams = {}) => request(`/api/v3/booking-affinity/top-products?${affinityQs(params)}`);
export const getAffinityCustomers = (params: QueryParams = {}) => request(`/api/v3/booking-affinity/customers?${affinityQs(params)}`);
export const getContactAffinity = (id: Id) => request(`/api/v3/booking-affinity/customers/${id}`);
export const searchAffinityProducts = (search: string, limit = 20) => request(`/api/v3/booking-affinity/products?${affinityQs({ search, limit })}`);
export const rebuildAffinity = () => request('/api/v3/booking-affinity/rebuild', { method: 'POST' });
export async function downloadAffinityCSV(params: QueryParams = {}): Promise<void> {
  const res = await authFetch(`${BASE}/api/v3/booking-affinity/customers.csv?${affinityQs(params)}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  saveBlob(await res.blob(), `customer_affinity_${params.view || 'service'}_${params.period || 'all'}.csv`);
}

// ── Chat Leads ───────────────────────────────────────────────
export const getChatLeadsSummary = (from: string, to: string) => request(`/api/v3/chat-leads/summary?from=${from}&to=${to}`);
export const getChatLeadsTrend = (from: string, to: string, granularity: string) => request(`/api/v3/chat-leads/trend?from=${from}&to=${to}&granularity=${granularity}`);
export const getMailLeadsSummary = (from: string, to: string) => request(`/api/v3/chat-leads/mail-summary?from=${from}&to=${to}`);
export const getMailLeadsTrend = (from: string, to: string, granularity: string) => request(`/api/v3/chat-leads/mail-trend?from=${from}&to=${to}&granularity=${granularity}`);
export const getRegistrationLeads = (params: QueryParams = {}) => {
  const qs = toQuery(Object.entries(params).filter(([, value]) => value !== '' && value != null));
  return request(`/api/v3/chat-leads/registrations${qs ? `?${qs}` : ''}`);
};
export const getRegistrationSummary = (source: string, from: string, to: string, granularity: string) => request(
  `/api/v3/chat-leads/registrations/summary?source=${source}&from=${from}&to=${to}&granularity=${granularity}`
);
export const getRegistrationPeriods = (source: string, unit: string, count: number) => request(
  `/api/v3/chat-leads/registrations/periods?source=${source}&unit=${unit}&count=${count}`
);
export const getChatLeadsDepartmentPeriods = (unit: string, count: number, from?: string, to?: string) => request(
  `/api/v3/chat-leads/department-periods?unit=${unit}${from && to ? `&from=${from}&to=${to}` : `&count=${count}`}`
);
export const getMailLeadsDepartmentPeriods = (unit: string, count: number, from?: string, to?: string) => request(
  `/api/v3/chat-leads/mail-department-periods?unit=${unit}${from && to ? `&from=${from}&to=${to}` : `&count=${count}`}`
);
// Users of one department (receiver) in a range — number, first message + its timestamp (expand row).
export const getChatLeadsDepartmentUsers = (
  receiver: string, from: string, to: string,
  { onlyNew = false, limit = 50, offset = 0 }: { onlyNew?: boolean; limit?: number; offset?: number } = {},
) => request(
  `/api/v3/chat-leads/department-users?receiver=${encodeURIComponent(receiver)}&from=${from}&to=${to}${onlyNew ? '&only_new=1' : ''}&limit=${limit}&offset=${offset}`
);

// ── Department Groups (Leads screen) ──
export const getDepartments = () => request('/api/v3/chat-leads/departments');
export const getDepartmentGroups = () => request('/api/v3/chat-leads/groups');
export const createDepartmentGroup = (data: JsonBody) => request('/api/v3/chat-leads/groups', { method: 'POST', body: JSON.stringify(data) });
export const updateDepartmentGroup = (id: Id, data: JsonBody) => request(`/api/v3/chat-leads/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteDepartmentGroup = (id: Id) => request(`/api/v3/chat-leads/groups/${id}`, { method: 'DELETE' });

// ── Daily Data Report ──────────────────────────────────────────
export const getReportCounts = (from: string, to: string) => request(`/api/v3/daily-report/counts?from=${from}&to=${to}`);
export const getReportPreview = (table: string, from: string, to: string) => request(`/api/v3/daily-report/preview/${table}?from=${from}&to=${to}`);

export async function downloadReportCSV(table: string, from: string, to: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/v3/daily-report/download/${table}?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  saveBlob(await res.blob(), `${table}_${from}_to_${to}.csv`);
}

// ── Unified Contacts ─────────────────────────────────────────
export const getUnifiedContacts = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/unified-contacts?${qs}`);
};
/** `bookings` = how many latest bookings per type to embed (server default 20; the profile pages the rest). */
export const getUnifiedContact = (id: Id, opts: { bookings?: number } = {}) =>
  request(`/api/v3/unified-contacts/${id}${opts.bookings ? `?${toQuery({ bookings: opts.bookings })}` : ''}`);
export const getContactJourneys = (id: Id) => request(`/api/v3/unified-contacts/${id}/journeys`);
export type ContactBookingType = 'tours' | 'packages' | 'hotels' | 'visas' | 'others' | 'flights';
export interface ContactBookingsPage { rows: Record<string, string>[]; total: number; page: number; limit: number; totalPages: number }
/** One page (20 by default) of a contact's bookings of one type; the profile loads more only when asked. */
export const getContactBookings = (id: Id, params: { type: ContactBookingType; page?: number; limit?: number }) =>
  request<ContactBookingsPage>(`/api/v3/unified-contacts/${id}/bookings?${toQuery({ type: params.type, page: params.page ?? 1, limit: params.limit ?? 20 })}`);
export const getContactRecommendations = (id: Id) => request(`/api/v3/unified-contacts/${id}/recommendations`);
export const updateUnifiedContact = (id: Id, data: JsonBody) => request(`/api/v3/unified-contacts/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
export const createUnifiedContact = (data: JsonBody) => request('/api/v3/unified-contacts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
export const deleteUnifiedContact = (id: Id) => request(`/api/v3/unified-contacts/${id}`, {
  method: 'DELETE',
});
export const getContactSourcesBreakdown = (from?: string, to?: string) => {
  const qs: string[] = [];
  if (from) qs.push(`from=${from}`);
  if (to) qs.push(`to=${to}`);
  return request<ApiEnvelope<SourcesBreakdown>>(`/api/v3/unified-contacts/sources-breakdown${qs.length ? `?${qs.join('&')}` : ''}`);
};
export const getUnifiedStats = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request<ApiEnvelope<UnifiedStats>>(`/api/v3/unified-contacts/stats${qs ? `?${qs}` : ''}`);
};
export const refreshSegmentationMV = () =>
  request('/api/v3/unified-contacts/refresh-segmentation-mv', { method: 'POST' });
export const recomputeSegmentation = () =>
  request('/api/v3/unified-contacts/recompute-segmentation', { method: 'POST' });
export const refreshSegmentationSnapshot = () =>
  request('/api/v3/snapshot/refresh', { method: 'POST' });

// ── Gupshup approval pipeline ───────────────────────────────
export const getGupshupConfig = () => request('/api/v3/gupshup/config');
export const submitTemplateForApproval = (templateId: Id) =>
  request(`/api/v3/gupshup/templates/${templateId}/submit`, { method: 'POST' });
export const checkGupshupStatus = (templateId: Id) =>
  request(`/api/v3/gupshup/templates/${templateId}/check-status`, { method: 'POST' });
export const setGupshupExternalId = (templateId: Id, externalId: string, { status, category }: { status?: string; category?: string } = {}) =>
  request(`/api/v3/gupshup/templates/${templateId}/set-external-id`, {
    method: 'POST', body: JSON.stringify({ externalId, status, category }),
  });
export const forceApproveGupshup = (templateId: Id) =>
  request(`/api/v3/gupshup/templates/${templateId}/force-approve`, { method: 'POST' });
export const getGupshupEvents = (templateId: Id) =>
  request(`/api/v3/gupshup/templates/${templateId}/events`);
export const bulkSubmitGupshup = () =>
  request('/api/v3/gupshup/bulk-submit', { method: 'POST' });
export const getUnifiedFilters = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/unified-contacts/filters${qs ? `?${qs}` : ''}`);
};
export const getSegmentationTree = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/unified-contacts/segmentation-tree?${qs}`);
};
export const getGeneralSegment = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/segments/general${qs ? `?${qs}` : ''}`);
};
export const getSegmentActivity = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/unified-contacts/segment-activity?${qs}`);
};
export const snapshotDailySegments = () => request('/api/v3/unified-contacts/snapshot-daily', { method: 'POST' });
export const getSegmentChanges = () => request('/api/v3/unified-contacts/segment-changes');
export const downloadSegmentActivity = async (params: QueryParams = {}): Promise<void> => {
  const qs = toQuery(params);
  const res = await authFetch(`${BASE}/api/v3/unified-contacts/segment-activity/download?${qs}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  saveBlob(await res.blob(), `segment_activity_${params.days || 30}d.csv`);
};
export const downloadSegmentCustomers = async (params: QueryParams = {}): Promise<void> => {
  const qs = toQuery(params);
  const res = await authFetch(`${BASE}/api/v3/unified-contacts/segment-customers/download?${qs}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  saveBlob(await res.blob(), `segment_${params.bookingStatus || 'all'}_customers.csv`);
};
export const getSegmentCustomers = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/unified-contacts/segment-customers?${qs}`);
};

// ── Custom Segments ──────────────────────────────────────────────────────────
export const getCustomSegments = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/custom-segments${qs ? `?${qs}` : ''}`);
};
export const getCustomSegmentById = (id: Id) => request(`/api/v3/custom-segments/${id}`);
export const createCustomSegment = (data: JsonBody) => request('/api/v3/custom-segments', { method: 'POST', body: JSON.stringify(data) });
export const updateCustomSegment = (id: Id, data: JsonBody) => request(`/api/v3/custom-segments/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCustomSegment = (id: Id) => request(`/api/v3/custom-segments/${id}`, { method: 'DELETE' });
export const previewSegmentCount = (conditions: JsonBody, operator: string) => request('/api/v3/custom-segments/preview-count', { method: 'POST', body: JSON.stringify({ conditions, operator }) });
export const searchContactsByEmail = (q: string) => { const qs = toQuery({ q }); return request(`/api/v3/test-sends/search-contacts?${qs}`); };
// Send the AI daily-master template (same as "Preview AI") to recipient emails.
// Uses the unified /send-daily-ai endpoint so Test Send == Preview AI == journey send.
export const sendTestDay = (day: Id, emails: string[]) =>
  request(`/api/v3/test-sends/send-daily-ai`, { method: 'POST', body: JSON.stringify({ templateId: day, emails }) });
// Send any approved email template (non-Day) from content_templates to recipient emails.
// Pulls the stored body HTML as-is (no Day-specific dynamic data assembly).
export const sendTemplate = (templateId: Id, emails: string[]) =>
  request(`/api/v3/test-sends/send-template`, { method: 'POST', body: JSON.stringify({ templateId, emails }) });

// ── WhatsApp (ChatHead) ──────────────────────────────────────────────
export const getWhatsAppChannels  = () => request('/api/v3/chathead/channels');
// Create / check a WhatsApp template on ChatHead (→ Meta review)
export const createWhatsAppTemplate = (payload: JsonBody) =>
  request('/api/v3/chathead/templates/create', { method: 'POST', body: JSON.stringify(payload) });
export const getWhatsAppTemplateStatus = (templateId: Id) =>
  request('/api/v3/chathead/templates/status', { method: 'POST', body: JSON.stringify({ template_id: templateId }) });
export const getWhatsAppTemplates = (channel: string) => request(`/api/v3/chathead/templates?channel=${encodeURIComponent(channel)}`);
export const previewWhatsAppTemplate = (id: Id) => request(`/api/v3/chathead/templates/${encodeURIComponent(id)}/preview`);
// ── SMS (Gupshup) test send ──
export const getSmsConfig    = () => request('/api/v3/gupshup/sms/config');
export const getSmsTemplates = () => request('/api/v3/gupshup/sms/templates');
export const smsTestSend = ({ phone, name, templateId }: { phone: string; name?: string; templateId: Id }) =>
  request('/api/v3/gupshup/sms/test-send', { method: 'POST', body: JSON.stringify({ phone, name, templateId }) });

// ── RCS (Gupshup RBM) test send ──
export const getRcsConfig = () => request('/api/v3/gupshup/rcs/config');
export const getRcsTemplates = () => request('/api/v3/gupshup/rcs/templates');
export const getRcsTemplatePreview = (code: string) => request(`/api/v3/gupshup/rcs/templates/${encodeURIComponent(code)}/preview`);
export const rcsTestSend = ({ phone, name, templateCode, customParams, smsFallback }: {
  phone: string; name?: string; templateCode: string; customParams?: JsonBody; smsFallback?: string;
}) =>
  request('/api/v3/gupshup/rcs/test-send', { method: 'POST', body: JSON.stringify({ phone, name, templateCode, customParams, smsFallback }) });

// ── Giveaway email events (BullMQ, log-only) ──
export const getGiveawayLog = (limit = 50) => request<GiveawayLog>(`/api/v3/giveaways/log?limit=${limit}`);
// ── Giveaway events captured by the RabbitMQ consumer ──
export const getGiveawayMqLog = (limit = 50) => request<GiveawayLog>(`/api/v3/giveaways/mq-log?limit=${limit}`);
export const giveawayTestSend = (body: JsonBody = {}) =>
  request('/api/v3/giveaways/email/test', { method: 'POST', body: JSON.stringify(body) });
export const whatsAppTestSend = ({ phone, name, channelId, channelName, templateId, templateName }: {
  phone: string; name?: string; channelId?: Id; channelName?: string; templateId?: Id; templateName?: string;
}) =>
  request('/api/v3/chathead/test-send', {
    method: 'POST',
    body: JSON.stringify({ phone, name, channelId, channelName, templateId, templateName }),
  });
// Post-send QA report for a template's email (grammar, content, URLs, spam-risk, errors)
export const analyzeTestEmail = (templateId: Id) =>
  request(`/api/v3/test-sends/analyze-email`, { method: 'POST', body: JSON.stringify({ templateId }) });
// Real inbox placement (Inbox/Spam) of a sent email, via IMAP on the seed inbox
export const checkInboxPlacement = (subject: string, templateId: Id) =>
  request(`/api/v3/test-sends/check-placement`, { method: 'POST', body: JSON.stringify({ subject, templateId }) });
// Fetch the stored QA report for a template (for the (i) button)
export const getStoredQaReport = (templateId: Id) =>
  request(`/api/v3/test-sends/qa-report/${templateId}`);
export const getCustomSegmentCustomers = (id: Id, params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/custom-segments/${id}/customers?${qs}`);
};

// ── Send Log ─────────────────────────────────────────────────────────────────
export const getSendLog = (params: QueryParams = {}) => {
  const qs = toQuery(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return request<{ data: SendLogPage }>(`/api/v3/test-sends/send-log${qs ? '?' + qs : ''}`);
};

// ── Email UTM Visit Tracking ──────────────────────────────────────────────────
export const getEmailUtmLog = (params: QueryParams = {}) => {
  const qs = toQuery(params);
  return request(`/api/v3/test-sends/utm-log${qs ? '?' + qs : ''}`);
};
export const getEmailUtmSummary = () => request('/api/v3/test-sends/utm-log/summary');

export async function downloadReportAll(from: string, to: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/v3/daily-report/download-all?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  saveBlob(await res.blob(), `rayna_daily_report_${from}_to_${to}.zip`);
}

// ── Overview (redesign, read-only) ───────────────────────────────────────────
export type OverviewUnavailable = { available: false; reason: 'unavailable' | 'timeout' };
export type OverviewSection<T> = ({ available: true } & T) | OverviewUnavailable;
export interface OverviewRange { from: string; to: string; days: number }
export interface OverviewChannelCounts { email: number; whatsapp: number; sms: number; total: number }
export interface OverviewTotals { sent: number; delivered: number; opened: number; clicked: number; unsubscribed: number }

export interface OverviewHome {
  sentToday: OverviewSection<OverviewChannelCounts>;
  delivery7d: OverviewSection<{ sent: number; delivered: number; deliveredPct: number }>;
  conversions30d: OverviewSection<{ count: number }>;
  runningJourneys: OverviewSection<{ total?: number; journeys: { id: number; name: string; status: string; joined: number }[] }>;
  sendingToday: OverviewSection<{ journeys: { id: number; name: string; due: number }[]; total: number }>;
  series14d: OverviewSection<{ days: ({ date: string } & OverviewChannelCounts)[] }>;
}

export interface OverviewInsights {
  range: OverviewRange;
  totals: OverviewSection<OverviewTotals>;
  previous: OverviewSection<{ from: string; to: string } & OverviewTotals>;
  weeklyTrend: OverviewSection<{ weeks: { week: string; sent: number; opened: number; clicked: number; openRate: number; clickRate: number }[] }>;
  funnel: OverviewSection<{ channel: 'email'; sent: number; opened: number; clicked: number; converted: number }>;
  journeys: OverviewSection<{ rows: { id: number; name: string; status: string | null; sent: number; opened: number; clicked: number; unsubscribed: number; openRate: number; clickRate: number }[] }>;
}

export type OverviewQueueChannel = 'email' | 'whatsapp' | 'sms' | 'rcs' | 'welcome' | 'gtmJourney';
export type OverviewQueue =
  | { channel: OverviewQueueChannel; available: true; waiting: number; active: number; delayed: number; completed: number; failed: number; paused: number }
  | { channel: OverviewQueueChannel; available: false };

export interface OverviewStatus {
  dataSources: OverviewSection<{ sources: { name: string; status: string | null; lastSyncedAt: string | null; lastRunAt: string | null; rows: number; durationMs: number; error: string | null }[] }>;
  queues: OverviewSection<{ queues: OverviewQueue[] }>;
  failedSends: OverviewSection<{ rows: { channel: string; id: number; recipient: string | null; reason: string | null; time: string | null; journeyId: number | null }[] }>;
}

export interface OverviewMessage {
  channel: string; id: number; recipient: string | null; contactName: string | null; label: string | null;
  status: string | null; error: string | null; journeyId: number | null; nodeId: string | null;
  time: string | null; openedAt: string | null; clickedAt: string | null;
}
export interface OverviewMessages {
  page: number; limit: number; days: number; channel: 'all' | 'email' | 'whatsapp' | 'sms';
  messages: OverviewSection<{ rows: OverviewMessage[] }>;
  total: number | null;
  /** true when the count stopped at the cap; show as "10,000+" */
  capped?: boolean;
}
export interface OverviewMessagesParams {
  channel?: 'email' | 'whatsapp' | 'sms'; status?: string; journeyId?: number; q?: string; page?: number; limit?: number; days?: number;
}

export interface OverviewWebsite {
  range: OverviewRange;
  eventsPerDay: OverviewSection<{ days: { date: string; events: number }[] }>;
  topEvents: OverviewSection<{ events: { name: string; count: number; uniqueUsers: number }[] }>;
  topPages: OverviewSection<{ pages: { url: string; count: number }[] }>;
  lastHour: OverviewSection<{ count: number }>;
  utmLinks: OverviewSection<{
    totals: { links: number; clickedLinks: number; clicks: number; campaigns: number; uniqueUsers: number };
    campaigns: { campaignId: number; name: string | null; segment: string | null; channel: string | null; links: number; clickedLinks: number; clicks: number; lastClick: string | null }[];
  }>;
}

function overviewQs(params: Record<string, string | number | undefined>): string {
  const qs = toQuery(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return qs ? `?${qs}` : '';
}
export const getOverviewHome = () => request<OverviewHome>('/api/v3/overview/home');
export type OverviewHomeSectionName = keyof OverviewHome;
export const OVERVIEW_HOME_SECTIONS: readonly OverviewHomeSectionName[] =
  ['sentToday', 'delivery7d', 'conversions30d', 'runningJourneys', 'sendingToday', 'series14d'];
/** One Home card's data (GET /api/v3/overview/home/:section), so each card loads on its own. */
export const getOverviewHomeSection = <K extends OverviewHomeSectionName>(section: K) =>
  request<OverviewHome[K]>(`/api/v3/overview/home/${section}`);
export const getOverviewInsights = (from?: string, to?: string) =>
  request<OverviewInsights>(`/api/v3/overview/insights${overviewQs({ from, to })}`);
export const getOverviewStatus = () => request<OverviewStatus>('/api/v3/overview/status');
export const getOverviewMessages = (params: OverviewMessagesParams = {}) =>
  request<OverviewMessages>(`/api/v3/overview/messages${overviewQs({ ...params })}`);
export const getOverviewWebsite = (from?: string, to?: string) =>
  request<OverviewWebsite>(`/api/v3/overview/website${overviewQs({ from, to })}`);
