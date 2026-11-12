/**
 * Type-only row shapes for src/services/JourneyService.ts.
 */

/** daily_ai_templates / journey_node_emails: SELECT subject, html, source */
export interface U1SubjectHtmlRow {
  subject: string;
  html: string;
  source: string;
}

/** JourneyService.getAll list row: journey_flows.* plus joined display columns. */
export type U1JourneyListRow = import('./journeyService.js').JourneyFlowRow & {
  segment_number?: number | null;
  priority?: number | null;
  stage_name?: string | null;
  stage_color?: string | null;
  node_count: number;
};

/** _gtmFanout row: (user × item) to enroll. */
export interface U1GtmFanoutRow {
  unifiedId: number;
  eventId: string | null;
  /** raw_payload->>'itemId' (or '_noitem'); typed as the enter() input expects. */
  itemId: string;
}

/** campaigns row read by getNodeSendLog (COUNT-ish columns may be INTEGER or BIGINT). */
export interface U1NodeCampaignRow {
  id: number;
  name: string;
  sent_count: string;
  fail_count: string;
  target_count: string;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date | null;
  delivered_count: string;
  read_count: string;
  click_count: string;
  bounce_count: string;
}

/** One action of an omnichannel strategy flow step. */
export interface U1StrategyAction {
  channel?: string;
  message?: string;
  timing?: string;
}

/** One omnichannel_strategies.flow_steps element. */
export interface U1StrategyFlowStep {
  day: number;
  label?: string;
  actions?: U1StrategyAction[];
}

/** omnichannel_strategies row (fields read by generateFromStrategy). */
export interface U1StrategyRow {
  id: number;
  name: string;
  description: string | null;
  segment_label: string | null;
  flow_steps: U1StrategyFlowStep[] | null;
}

/** UPDATE journey_entries ... RETURNING je.entry_id, je.current_node_id */
export interface U1EntryNodeRow {
  entry_id: number;
  current_node_id: string;
}

/** journey_entries.* joined with the unified_contacts columns processJourney reads. */
export interface U1ActiveEntryRow {
  entry_id: number;
  journey_id: number;
  customer_id: number;
  current_node_id: string;
  track: string | null;
  status: string;
  entered_at: Date;
  next_fire_at: Date | null;
  last_enqueued_at: Date | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  booking_status: string | null;
  email_unsubscribe: string | null;
  is_indian: boolean | null;
}

/** journey_node_stats row incl. the email-engagement rollup columns (getJourneyCampaignAnalytics). */
export type U1NodeStatsRollupRow = import('./journeyService.js').JourneyNodeStatsRow & {
  opened: string;
  clicked: string;
  human_opened: string;
  human_clicked: string;
  landed: string;
  delivered: string;
  bounced: string;
  target_count: string;
  computed_at: Date;
};

/** getEntries list row. */
export interface U1JourneyEntryListRow {
  entry_id: number;
  customer_id: number;
  current_node_id: string;
  status: string;
  entered_at: Date;
  completed_at: Date | null;
  converted_at: Date | null;
  exit_reason: string | null;
  next_fire_at: Date | null;
  track: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  booking_status: string | null;
}

/** campaigns row read by getJourneyCampaignAnalytics (BIGINT/NUMERIC as strings). */
export interface U1JourneyCampaignRow {
  id: number;
  name: string;
  channel: string;
  status: string;
  template_id: number | null;
  sent_count: string;
  delivered_count: string;
  read_count: string;
  click_count: string;
  bounce_count: string;
  fail_count: string;
  conversion_count: string;
  revenue_total: string;
  journey_node_id: string;
  target_count: string;
  started_at: Date | null;
  completed_at: Date | null;
  template_body: string | null;
  template_name: string | null;
}

/** getEnrollments row. */
export interface U1EnrollmentRow {
  entry_id: number;
  journey_id: number;
  customer_id: number;
  current_node_id: string;
  status: string;
  entered_at: Date;
  completed_at: Date | null;
  converted_at: Date | null;
  exit_reason: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  booking_status: string | null;
  segments: unknown;
}

/** processDueEntries row (journey_entries ⨝ journey_flows ⨝ unified_contacts). */
export interface U1DueEntryRow {
  entry_id: number;
  journey_id: number;
  customer_id: number;
  current_node_id: string;
  entered_at: Date;
  track: string | null;
  last_run_id: string | null;
  booking_status: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  is_indian: boolean | null;
  current_segment: unknown;
  nodes: unknown;
  edges: unknown;
  segment_id: number | null;
  exit_on_conversion: boolean | null;
  journey_segment: string | null;
}

/** email_send_log per-node engagement aggregate (::int columns). */
export interface U1NodeSendAggRow {
  node_id: string;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  total: number;
}
