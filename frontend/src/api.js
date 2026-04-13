const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Strategies ──────────────────────────────────────────────
export const getStrategies = () => request('/api/v2/strategies');
export const getStrategy = (id) => request(`/api/v2/strategies/${id}`);
export const createStrategy = (data) => request('/api/v2/strategies', { method: 'POST', body: JSON.stringify(data) });
export const updateStrategy = (id, data) => request(`/api/v2/strategies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const optimizeStrategy = (id) => request(`/api/v2/strategies/${id}/optimize`, { method: 'POST' });

// ── Content Templates ───────────────────────────────────────
export const getTemplates = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v2/content/templates?${qs}`);
};
export const getTemplate = (id) => request(`/api/v2/content/templates/${id}`);
export const previewTemplate = (id) => request(`/api/v2/content/templates/${id}/preview`);
export const createTemplate = (data) => request('/api/v2/content/templates', { method: 'POST', body: JSON.stringify(data) });
export const updateTemplate = (id, data) => request(`/api/v2/content/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const approveTemplate = (id) => request(`/api/v2/content/templates/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy: 'admin' }) });
export const rejectTemplate = (id) => request(`/api/v2/content/templates/${id}/reject`, { method: 'POST' });
export const generateContent = (data) => request('/api/v2/content/generate', { method: 'POST', body: JSON.stringify(data) });

// ── Campaigns ───────────────────────────────────────────────
export const getCampaigns = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v2/campaigns?${qs}`);
};
export const getCampaign = (id) => request(`/api/v2/campaigns/${id}`);
export const createCampaign = (data) => request('/api/v2/campaigns', { method: 'POST', body: JSON.stringify(data) });
export const executeCampaign = (id) => request(`/api/v2/campaigns/${id}/execute`, { method: 'POST' });
export const processQueue = (batch = 100) => request(`/api/v2/campaigns/process-queue?batch=${batch}`, { method: 'POST' });
export const getCampaignPerformance = () => request('/api/v2/campaigns/performance');

// ── Health ──────────────────────────────────────────────────
export const healthCheck = () => request('/api/health');

// ══════════════════════════════════════════════════════════════
// V3 API — 28-Segment Engine, Journeys, Funnel, AI Agents
// ══════════════════════════════════════════════════════════════

// ── Segments v3 (28 segments, 7 funnel stages) ──────────────
export const getSegments = async () => {
  const res = await getFunnelOverview();
  const segments = (res.data || []).flatMap(stage =>
    (stage.segments || []).map(s => ({ ...s, stage_name: stage.stage_name, stage_color: stage.stage_color }))
  );
  return segments;
};
export const getFunnelOverview = () => request('/api/v3/segments/funnel');
export const getSegmentSummary = () => request('/api/v3/segments/summary');
export const runSegmentation = () => request('/api/v3/segments/run', { method: 'POST' });
export const getSegmentV3 = (id) => request(`/api/v3/segments/${id}`);
export const getSegmentV3Customers = (id, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/segments/${id}/customers?${qs}`);
};
export const getSegmentConversions = (id) => request(`/api/v3/segments/${id}/conversions`);

// ── Journeys (Flow Builder) ─────────────────────────────────
export const getJourneys = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/journeys?${qs}`);
};
export const getJourney = (id) => request(`/api/v3/journeys/${id}`);
export const createJourney = (data) => request('/api/v3/journeys', { method: 'POST', body: JSON.stringify(data) });
export const updateJourney = (id, data) => request(`/api/v3/journeys/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteJourney = (id) => request(`/api/v3/journeys/${id}`, { method: 'DELETE' });
export const generateJourneyFromStrategy = (strategyId) => request(`/api/v3/journeys/generate-from-strategy/${strategyId}`, { method: 'POST' });
export const enrollJourney = (id) => request(`/api/v3/journeys/${id}/enroll`, { method: 'POST' });
export const processJourney = (id) => request(`/api/v3/journeys/${id}/process`, { method: 'POST' });
export const getJourneyAnalytics = (id) => request(`/api/v3/journeys/${id}/analytics`);
export const getJourneyCampaignAnalytics = (id) => request(`/api/v3/journeys/${id}/campaign-analytics`);
export const checkJourneyConversions = (id) => request(`/api/v3/journeys/${id}/check-conversions`, { method: 'POST' });
export const getJourneyEnrollments = (id) => request(`/api/v3/journeys/${id}/enrollments`);

// ── Conversion Funnel ───────────────────────────────────────
export const getFunnelData = () => request('/api/v3/funnel/overview');
export const getSegmentFunnel = (id) => request(`/api/v3/funnel/segment/${id}`);
export const recordConversion = (data) => request('/api/v3/funnel/convert', { method: 'POST', body: JSON.stringify(data) });
export const getChannelEffectiveness = () => request('/api/v3/funnel/channels');
export const getKeyMetrics = () => request('/api/v3/funnel/metrics');

// ── AI Agents ───────────────────────────────────────────────
export const aiCopywrite = (data) => request('/api/v3/agents/copywriter/generate', { method: 'POST', body: JSON.stringify(data) });
export const aiSegmentAnalysis = () => request('/api/v3/agents/segment-assist/analyze');
export const aiFlowSuggest = (journeyId) => request(`/api/v3/agents/flow-assist/suggest/${journeyId}`);
export const aiFlowOptimize = (journeyId) => request(`/api/v3/agents/flow-assist/auto-optimize/${journeyId}`, { method: 'POST' });
export const aiInsights = () => request('/api/v3/agents/insights');
export const aiAutoOptimize = () => request('/api/v3/agents/auto-optimize', { method: 'POST' });
export const getAgentLogs = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/agents/logs?${qs}`);
};

// ── RFM Analysis ──────────────────────────────────────────────
export const getRFMOverview = () => request('/api/v3/rfm');
export const getSegmentRFM = (id) => request(`/api/v3/rfm/segment/${id}`);
export const recalculateRFM = () => request('/api/v3/rfm/recalculate', { method: 'POST' });

// ── UTM Tracking ──────────────────────────────────────────────
export const buildUTM = (data) => request('/api/v3/utm/build', { method: 'POST', body: JSON.stringify(data) });
export const getUTMSegments = () => request('/api/v3/utm/segments');
export const generateSegmentUTM = (label) => request(`/api/v3/utm/segment/${encodeURIComponent(label)}`, { method: 'POST' });
export const generateAllUTM = () => request('/api/v3/utm/generate-all', { method: 'POST' });
export const generateCampaignUTM = (id) => request(`/api/v3/utm/campaign/${id}`, { method: 'POST' });
export const getUTMAnalytics = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/utm/analytics?${qs}`);
};
export const recordUTMClick = (id) => request(`/api/v3/utm/${id}/click`, { method: 'POST' });
export const recordUTMConversion = (id, revenue) => request(`/api/v3/utm/${id}/conversion`, { method: 'POST', body: JSON.stringify({ revenue }) });

// ── Per-User UTM Links ──────────────────────────────────────────
export const generateUserLinks = (campaignId, data = {}) => request(`/api/v3/utm/user-links/${campaignId}`, { method: 'POST', body: JSON.stringify(data) });
export const getUserLinks = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/utm/user-links?${qs}`);
};
export const getUserLinkStats = () => request('/api/v3/utm/user-links-stats');

// ── Coupons ───────────────────────────────────────────────────
export const getCoupons = () => request('/api/v3/coupons');
export const getCoupon = (id) => request(`/api/v3/coupons/${id}`);
export const createCoupon = (data) => request('/api/v3/coupons', { method: 'POST', body: JSON.stringify(data) });
export const validateCoupon = (data) => request('/api/v3/coupons/validate', { method: 'POST', body: JSON.stringify(data) });
export const updateCoupon = (id, data) => request(`/api/v3/coupons/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCoupon = (id) => request(`/api/v3/coupons/${id}`, { method: 'DELETE' });
export const applyCoupon = (data) => request('/api/v3/coupons/apply', { method: 'POST', body: JSON.stringify(data) });
export const getSegmentCoupons = (label) => request(`/api/v3/coupons/segment/${encodeURIComponent(label)}`);

// ── Human Approvals ──────────────────────────────────────────
export const getApprovalQueue = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/approvals?${qs}`);
};
export const getApprovalStats = () => request('/api/v3/approvals/stats');
export const getApproval = (id) => request(`/api/v3/approvals/${id}`);
export const requestApproval = (data) => request('/api/v3/approvals', { method: 'POST', body: JSON.stringify(data) });
export const approveItem = (id, reviewedBy) => request(`/api/v3/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ reviewedBy }) });
export const rejectItem = (id, reviewedBy) => request(`/api/v3/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reviewedBy }) });
export const aiAnalyzeStrategies = () => request('/api/v3/approvals/ai-analyze', { method: 'POST' });

// ── GTM & BigQuery ────────────────────────────────────────────
export const getGTMSnippet = (containerId) => request(`/api/v3/gtm/snippet?containerId=${containerId || ''}`);
export const getDataLayerScripts = () => request('/api/v3/gtm/datalayer');
export const recordGTMEvent = (data) => request('/api/v3/gtm/events', { method: 'POST', body: JSON.stringify(data) });
export const getGTMAnalytics = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/gtm/analytics?${qs}`);
};
export const getGTMEventDetail = (eventName) => request(`/api/v3/gtm/events/${encodeURIComponent(eventName)}`);
export const getGTMExport = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/gtm/export?${qs}`);
};
export const getSpecialOccasions = () => request('/api/v3/gtm/occasions');
export const createSpecialOccasion = (data) => request('/api/v3/gtm/occasions', { method: 'POST', body: JSON.stringify(data) });

// ── Products (Real Rayna Tours Catalog) ──────────────────────
export const getProducts = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/products?${qs}`);
};
export const getProductCategories = () => request('/api/v3/products/categories');
export const getProduct = (id) => request(`/api/v3/products/${id}`);
export const getSegmentProducts = (label, limit = 3) => request(`/api/v3/products/segment/${encodeURIComponent(label)}?limit=${limit}`);
export const generateProductEmail = (data) => request('/api/v3/products/generate-email', { method: 'POST', body: JSON.stringify(data) });
export const generateProductWA = (data) => request('/api/v3/products/generate-wa', { method: 'POST', body: JSON.stringify(data) });
export const generateContentWithProducts = (data) => request('/api/v2/content/generate-with-products', { method: 'POST', body: JSON.stringify(data) });

// ── Base Email Templates (Production Rayna Tours) ────────────
export const getBaseTemplates = () => request('/api/v3/base-templates');
export const getBaseTemplate = (id) => request(`/api/v3/base-templates/${id}`);
export const previewBaseTemplate = (id) => request(`/api/v3/base-templates/${id}/preview`);
export const renderBaseTemplate = (id, data) => request(`/api/v3/base-templates/${id}/render`, { method: 'POST', body: JSON.stringify(data) });
export const useBaseTemplate = (id, data) => request(`/api/v3/base-templates/${id}/use`, { method: 'POST', body: JSON.stringify(data) });
export const getSegmentEmailTemplates = () => request('/api/v3/base-templates/segments/all');
export const previewSegmentEmail = (name) => request(`/api/v3/base-templates/segments/${encodeURIComponent(name)}/preview`);
export const useSegmentEmail = (name, data) => request(`/api/v3/base-templates/segments/${encodeURIComponent(name)}/use`, { method: 'POST', body: JSON.stringify(data) });

// ── Product Affinity ─────────────────────────────────────────
export const getAffinityAll = () => request('/api/v3/affinity');
export const getSegmentAffinity = (id) => request(`/api/v3/affinity/segment/${id}`);
export const getAffinityWhat = (id) => request(`/api/v3/affinity/segment/${id}/what`);
export const getAffinityWhen = (id) => request(`/api/v3/affinity/segment/${id}/when`);
export const getAffinityHow = (id) => request(`/api/v3/affinity/segment/${id}/how`);
export const getAffinityStats = () => request('/api/v3/affinity/stats');
export const getAffinityMatrix = () => request('/api/v3/affinity/matrix');
export const getDepartmentMap = () => request('/api/v3/affinity/departments');

// ── Data Pipeline (Rayna Sync + MySQL Sync + Mapping) ───────
export const getRaynaSyncStatus = () => request('/api/v3/rayna-sync/status');
export const getMappingStats = () => request('/api/v3/rayna-sync/mapping-stats');
export const triggerRaynaSync = () => request('/api/v3/rayna-sync/trigger', { method: 'POST' });
export const triggerRaynaSyncEndpoint = (ep) => request(`/api/v3/rayna-sync/trigger/${ep}`, { method: 'POST' });
export const refreshBookingMapping = () => request('/api/v3/rayna-sync/refresh-mapping', { method: 'POST' });

// ── V3 Migrations ───────────────────────────────────────────
export const runV3MigrateAll = () => request('/api/v3/migrate-all', { method: 'POST' });
export const runV3MigrateSchema = () => request('/api/v3/migrate-schema', { method: 'POST' });
export const runV3MigrateSegments = () => request('/api/v3/migrate-segments', { method: 'POST' });
export const runV3MigrateRFM = () => request('/api/v3/migrate-rfm', { method: 'POST' });

// ── Daily Data Report ──────────────────────────────────────────
export const getReportCounts = (from, to) => request(`/api/v3/daily-report/counts?from=${from}&to=${to}`);
export const getReportPreview = (table, from, to) => request(`/api/v3/daily-report/preview/${table}?from=${from}&to=${to}`);

export async function downloadReportCSV(table, from, to) {
  const res = await fetch(`${BASE}/api/v3/daily-report/download/${table}?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${table}_${from}_to_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Unified Contacts ─────────────────────────────────────────
export const getUnifiedContacts = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/unified-contacts?${qs}`);
};
export const getUnifiedContact = (id) => request(`/api/v3/unified-contacts/${id}`);
export const getUnifiedStats = () => request('/api/v3/unified-contacts/stats');
export const getUnifiedFilters = () => request('/api/v3/unified-contacts/filters');
export const getSegmentationTree = () => request('/api/v3/unified-contacts/segmentation-tree');
export const getSegmentCustomers = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/v3/unified-contacts/segment-customers?${qs}`);
};

export async function downloadReportAll(from, to) {
  const res = await fetch(`${BASE}/api/v3/daily-report/download-all?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rayna_daily_report_${from}_to_${to}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
