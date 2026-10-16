// Types for app/(dashboard)/journeys/page.tsx — only the fields the page reads.

export type TplId = string | number | null;

export interface NodeForm {
  type: string;
  channel: string;
  label: string;
  message?: string;
  waitDays: number | string;
  waitUnit?: string;
  goalType: string;
  condition: string;
  track?: string;
  emailTemplateId: TplId;
  whatsappTemplateId: TplId;
  smsTemplateId: TplId;
  restChannel: string;
  restTemplateId: TplId;
  waChannelId: TplId;
  waChannelName: string | null;
  waTemplateId: TplId;
  waTemplateName: string | null;
  rcsTemplateCode: string | null;
  rcsTemplateName: string | null;
  rcsTemplateType: string | null;
  sendHour?: number | string | null;
  templateVariables: Record<string, string>;
}

export interface JourneyNodeData {
  label?: string;
  channel?: string;
  message?: string;
  waitDays?: number | string;
  waitUnit?: string;
  goalType?: string;
  condition?: string;
  track?: string;
  sendHour?: number | string | null;
  templateId?: TplId;
  emailTemplateId?: TplId;
  whatsappTemplateId?: TplId;
  smsTemplateId?: TplId;
  restChannel?: string;
  restTemplateId?: TplId;
  waChannelId?: TplId;
  waChannelName?: string | null;
  waTemplateId?: TplId;
  waTemplateName?: string | null;
  templateName?: string;
  rcsTemplateCode?: string | null;
  rcsTemplateName?: string | null;
  rcsTemplateType?: string | null;
  templateVariables?: Record<string, string>;
  timing?: string;
  segmentLabel?: string;
  triggerType?: string;
  segmentId?: string | null;
}

export interface JourneyNode {
  id: string;
  type: string;
  data?: JourneyNodeData;
  position?: { x: number; y: number };
}

export interface JourneyEdge { id: string; source: string; target: string }

export interface ContentTemplate {
  id: number | string;
  name?: string;
  subject?: string;
  channel?: string;
  body?: string;
  body_html?: string;
  wa_template_name?: string;
  variables?: unknown;
}

export type NumLike = number | string | null | undefined;

export interface JourneySummary {
  journey_id: number;
  name?: string;
  description?: string;
  segment_name?: string;
  status: string;
  journey_type?: string;
  total_entries?: number;
  node_count?: number;
  total_conversions?: number;
  conversion_rate: string;
  nodes?: JourneyNode[];
  created_at?: string;
  updated_at?: string;
  snapshot_count?: NumLike;
  trigger_event?: string;
  scheduled_start_at?: string;
  test_mode?: boolean;
}

export interface EntryStats {
  total_entries: string;
  active: string;
  completed: string;
  exited_booked: string;
  unsubscribed_during_journey?: string;
  exited_unsubscribed: string;
  unsubscribed_from_journey?: string;
  pre_existing_unsub: number;
}

export interface NodeAnalyticsRow { node_id: string; event_type: string; event_count: string; channel?: string }
export interface NodeEntryCountRow { node_id: string; triggered: string; exited: string }
export interface NodeStat { active: number; exited_booked: number; completed: number; exited: number }

export interface JourneyDetail extends JourneySummary {
  nodes?: JourneyNode[];
  edges?: JourneyEdge[];
  entryStats?: EntryStats;
  nodeAnalytics?: NodeAnalyticsRow[];
  nodeEntryCounts?: NodeEntryCountRow[];
  nodeUnsubCounts?: Record<string, number>;
  node_stats?: Record<string, NodeStat>;
  node_statuses?: Record<string, string>;
  node_ranking_sources?: Record<string, string>;
  goal_type?: string;
  stage_name?: string;
  stage_color?: string;
}

export interface CampaignRow {
  channel?: string;
  journey_node_id?: string;
  template_id?: number | string;
  target_count: string;
  sent_count: string;
  delivered_count: string;
  read_count: string;
  gtm_click_count: string;
  click_count: string;
  bounce_count: string;
  fail_count: string;
  started_at?: string;
  completed_at?: string;
  template_body?: string;
  name?: string;
  delivery_rate?: number | string;
  open_rate?: number | string;
  click_rate?: number | string;
}

export interface WaNodeStats { sent?: number; delivered?: number; opened?: number; clicked?: number; failed?: number }

export interface CampaignData {
  campaigns?: CampaignRow[];
  target_count?: string;
  totals?: { total_failed?: number };
  whatsapp_by_node?: Record<string, WaNodeStats>;
  delivered_by_node?: Record<string, number>;
  sent_by_node?: Record<string, number>;
  bounced_by_node?: Record<string, number>;
  opens?: Record<string, number>;
  clicks?: Record<string, number>;
  gtm_clicks?: Record<string, number>;
  human_opens?: Record<string, number>;
  human_clicks?: Record<string, number>;
  landed_clicks?: Record<string, number>;
}

export interface FireTimeRow { current_node_id: string; earliest_fire_at?: string; latest_fire_at?: string; active_count: string }
export interface FunnelRow { current_node_id: string; status?: string; count?: number | string }
export interface JourneyAnalytics { nodeFireTimes?: FireTimeRow[]; funnelData?: FunnelRow[] }

export interface QueueCounts { waiting?: number; active?: number; delayed?: number; failed?: number; completed?: number }

export interface TimelineItem { nodeId: string; triggeredAt?: string; nextFireAt?: string; predictedAt?: string; status?: string }

export interface JourneyEntry {
  entry_id: number | string;
  current_node_id?: string;
  name?: string;
  email?: string;
  status: string;
  exit_reason?: string;
  booking_status?: string;
  next_fire_at?: string;
  entered_at?: string;
}

export interface FlowSuggestion { impact?: string; title?: string; description?: string }
export interface FlowSuggestions { overall_score: number; suggestions?: FlowSuggestion[] }

export interface PreviewTemplateState {
  id?: number | string;
  name?: string;
  subject?: string;
  channel?: string;
  body?: string;
  body_html?: string | null;
  message?: string;
  rankingSource?: string | null;
  _loading?: boolean;
}

export interface ApiData<T> { data?: T; total?: number }

export interface CreateForm {
  name: string;
  description: string;
  segmentId: string;
  journeyType: string;
  triggerEvent: string;
  triggerFromDate: string;
  exitOnConversion: boolean;
  scheduledStartAt: string;
  testMode: boolean;
  testEmail: string;
  testWaitSec: number | string;
  recommendationType: string;
  emailCredential?: string;
  triggerSource?: string;
}

export interface NodeCampaign {
  total: number;
  target: number;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  bounced: number;
  failed: number;
  startedAt: string | null;
  completedAt: string | null;
  template_body: string | null;
  campaign_name?: string;
  delivery_rate?: number | string;
  open_rate?: number | string;
  click_rate?: number | string;
}

export interface NodeFireTimes {
  earliestFireAt: number | null;
  latestFireAt: number | null;
  activeCount: number;
  /** Read by the page but never populated (see report). */
  earliestEnqueued?: number | null;
}
