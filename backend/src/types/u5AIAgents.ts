/** Row / result shapes for src/services/AIAgents.ts (type-only module). */

/** segment_definitions + stage name + audience size, as read by Copywriter. */
export interface CopywriterSegmentRow {
  segment_name: string;
  segment_description: string | null;
  customer_type: string | null;
  priority: string;
  stage_name: string;
  /** COUNT(*) → string */
  audience_size: string;
  key_points: unknown;
  [key: string]: unknown;
}

export interface SegmentDistributionRow {
  segment_name: string;
  priority: string;
  customer_type: string | null;
  /** COUNT → string (the code also guards against a numeric 0) */
  customer_count: string | number;
}

export interface CustomerTotalsRow {
  total: string;
  never_booked: string;
  dormant: string;
  frequent: string;
}

export interface CntRow {
  cnt: string;
}

export interface AgentSuggestion {
  type: string;
  title: string;
  description: string;
  impact: string;
  [key: string]: unknown;
}

/** campaigns aggregate (COUNT/SUM/NUMERIC → string; SUM/AVG are NULL when no rows). */
export interface CampaignStatsRow {
  total_campaigns: string;
  total_sent: string | null;
  total_delivered: string | null;
  total_read: string | null;
  total_clicked: string | null;
  total_bounced: string | null;
  avg_delivery_rate: string;
  avg_open_rate: string;
  avg_click_rate: string;
}

export interface SegmentPerfRow {
  segment_name: string;
  priority: string;
  customers: string;
  conversions: string;
  revenue: string;
}

export interface ChannelPerfRow {
  channel: string;
  campaigns: string;
  sent: string | null;
  delivered: string | null;
  clicked: string | null;
}

export interface Insight {
  type: string;
  title: string;
  description: string;
  metric?: string;
  [key: string]: unknown;
}

export interface InsightRecommendation {
  priority: string;
  action: string;
  expected_impact: string;
  [key: string]: unknown;
}

export interface InsightsResult {
  insights: Insight[];
  recommendations: InsightRecommendation[];
  [key: string]: unknown;
}

/** omnichannel_strategies.* plus campaign aggregates (AVG over NUMERIC → string | null). */
export interface StrategyPerfRow {
  id: number;
  name: string;
  channels: string[] | null;
  campaign_count: string;
  avg_delivery: string | null;
  avg_open: string | null;
  avg_click: string | null;
  [key: string]: unknown;
}
