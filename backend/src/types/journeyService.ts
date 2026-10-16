/**
 * Type-only definitions for src/services/JourneyService.ts.
 */
import type { JourneyEdge, JourneyNode } from './queueJobs.js';
import type { PlaceholderPayload, PlaceholderValues } from './utilsPlaceholder.js';

/** Journey ids arrive as numbers (pg int) or strings (route params). */
export type JourneyId = string | number;

/** Known keys of a journey node's `data` (JSONB, authored by the flow builder UI). */
export interface JourneyNodeData {
  track?: string;
  label?: string;
  channel?: string;
  templateId?: string | number;
  emailTemplateId?: string | number;
  whatsappTemplateId?: string | number;
  smsTemplateId?: string | number;
  rcsTemplateCode?: string;
  rcsTemplateName?: string;
  waChannelId?: string;
  waChannelName?: string | null;
  waTemplateId?: string;
  waTemplateName?: string | null;
  templateVariables?: PlaceholderPayload;
  waitDays?: number;
  sendHour?: number | string | null;
  condition?: string;
  [key: string]: unknown;
}

/** journey_flows.nodes element, with the data keys JourneyService reads. */
export interface JourneyFlowNode extends JourneyNode {
  id: string;
  type?: string;
  data?: JourneyNodeData;
}

/** journey_flows.edges element. */
export interface JourneyFlowEdge extends JourneyEdge {
  id?: string;
  label?: string;
}

export type JourneyFlowNodeMap = Record<string, JourneyFlowNode>;

/** journey_flows row (SELECT * plus the optional joined display columns). */
export interface JourneyFlowRow {
  journey_id: number;
  name: string;
  description?: string | null;
  status: string;
  audience?: string | null;
  segment_id?: number | string | null;
  custom_segment_id?: number | null;
  strategy_id?: number | null;
  nodes: JourneyFlowNode[] | null;
  edges: JourneyFlowEdge[] | null;
  journey_type?: string | null;
  trigger_event?: string | null;
  trigger_from_date?: Date | string | null;
  trigger_source?: string | null;
  node_synced_at?: Record<string, string> | null;
  node_statuses?: Record<string, string> | null;
  exit_on_conversion?: boolean | null;
  test_mode?: boolean | null;
  test_email?: string | null;
  email_credential?: string | null;
  snapshot_count?: number | null;
  scheduled_start_at?: Date | string | null;
  total_conversions?: number | string | null;
  /** INTEGER DEFAULT 0 */
  total_entries?: number;
  /** NUMERIC(5,2) — pg returns NUMERIC as a string, e.g. "3.50" */
  conversion_rate?: string | number | null;
  // joined display columns (getById / getAll / getJourneyCampaignAnalytics)
  segment_name?: string | null;
  custom_segment_name?: string | null;
  segment_label?: string | null;
}

/** journey_node_stats rollup row (fields read by getById). */
export interface JourneyNodeStatsRow {
  node_id: string;
  channel?: string | null;
  entry_stats?: Record<string, unknown> | null;
  sent: number | string;
  failed: number | string;
  entries: number | string;
  dist_snapshot: number | string;
  dist_active: number | string;
  dist_waiting: number | string;
  dist_completed: number | string;
  dist_exited_booked: number | string;
  dist_exited_unsub: number | string;
}

/** Per-node entry distribution used by getById. */
export interface JourneyNodeDistribution {
  snapshot: number;
  active: number;
  waiting: number;
  completed: number;
  exited_booked: number;
  exited_unsub: number;
}

/** Per-node user stats returned by getById. */
export interface JourneyNodeUserStats {
  snapshot: number;
  active: number;
  exited_booked: number;
  exited_unsubscribed: number;
  completed: number;
  total: number;
  exited?: number;
}

/** One engine-event aggregate (journey_events GROUP BY node/event/channel). */
export interface JourneyNodeAnalyticsRow {
  node_id: string;
  event_type: string;
  channel: string | null;
  event_count: number | string;
}

/** gtm_journey_entries exit distribution row (getById GTM branch). */
export interface GtmExitDistRow {
  node: string;
  exited: number;
  purchased: number;
  unsubscribed: number;
}

/** Job payload built by processJourney for the per-channel send queues. */
export interface JourneyActionJobData {
  entryId: string | number;
  customerId: string | number;
  journeyId: JourneyId;
  nodeId: string;
  runId: string;
  channel: string;
  templateId: string | number | null | undefined;
  htmlTemplateId: string | number | null;
  waChannelId: string | null;
  waChannelName: string | null;
  waTemplateId: string | null;
  waTemplateName: string | null;
  rcsTemplateCode: string | null;
  rcsTemplateName: string | null;
  rcsCustomParams: PlaceholderValues | null;
  emailCredential: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  isIndian: boolean | null;
  track: string;
  autoPaired: boolean;
  originalChannel: string;
  templateVariables: PlaceholderPayload;
  enqueuedDubaiDate: string;
  firstActionNodeId: string | null;
}

export interface JourneyActionJob {
  data: JourneyActionJobData;
  opts: { jobId: string };
}

/** Result shape of the Claude ranking services (Day*RankingService / VisaRankingService). */
export interface RankingFetchResult {
  ranking?: unknown;
  source?: string;
}

export type RankingFetchFn = () => Promise<RankingFetchResult>;

/** Entry of the in-memory ranking cache. */
export interface RankingCacheEntry {
  ranking: unknown;
  source: string;
  expiresAt: number;
}

/** Day-template render result (renderDayHtml). */
export interface DayHtmlResult {
  html: string;
  subject: string;
}

/** Options accepted by JourneyService.create(). */
export interface CreateJourneyInput {
  name: string;
  description?: string | null;
  segmentId?: string | number | null;
  strategyId?: number | string | null;
  nodes?: JourneyFlowNode[] | null;
  edges?: JourneyFlowEdge[] | null;
  goalType?: string | null;
  goalValue?: string | number | null;
  createdBy?: string | null;
  audience?: string | null;
  exitOnConversion?: boolean;
  scheduledStartAt?: string | Date | null;
  testMode?: boolean;
  testEmail?: string | null;
  testWaitSec?: number | null;
  journeyType?: string | null;
  triggerEvent?: string | string[] | null;
  triggerFromDate?: string | Date | null;
  recommendationType?: string | null;
  emailCredential?: string | null;
  triggerSource?: string | null;
}

/** Arguments of JourneyService._snapshotEntries(). */
export interface SnapshotEntriesArgs {
  customSegmentId: number | null;
  stdSegmentId: string | number | null;
  audience: string | null | undefined;
  firstNodeId: string;
}

/** journey_flows row with nodes/edges normalised to arrays (getOpsDashboard). */
export type JourneyFlowGraph = Omit<JourneyFlowRow, 'nodes' | 'edges'> & {
  nodes: JourneyFlowNode[];
  edges: JourneyFlowEdge[];
};

/** One forecast item of getOpsDashboard. */
export interface JourneyForecastItem {
  journeyId: number;
  journeyName: string;
  nodeId: string;
  templateId: string | number | null;
  dayNumber: string | number | null;
  label: string;
  channel: string;
  sendHour: number | string | null;
  approximate: boolean;
  count: number;
}

/** One running-node item of getOpsDashboard. */
export interface JourneyRunningNode {
  nodeId: string;
  label: string;
  type: string;
  count: number;
  nextFire: Date | string | null;
  status: string | null;
}

export interface JourneyRunningGroup {
  journeyId: number;
  journeyName: string;
  status: string;
  nodes: JourneyRunningNode[];
}
