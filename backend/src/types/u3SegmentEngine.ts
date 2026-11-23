// Row shapes for SegmentEngine queries (type-only).

export type GenericRow = Record<string, unknown>;

export interface FunnelStageRow extends GenericRow {
  segments: unknown[];
}

export interface SegmentPageStatsRow {
  total_segments: string;
  total_stages: string;
  active_strategies: string;
  segmented_customers: string;
  total_customers: string;
}

export interface SchemaColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface SegmentDetailRow extends GenericRow {
  segment_name: string;
  stage_name: string;
  stage_number: number;
  stage_color: string;
  customer_count: string;
}

export interface SegmentMetricsRow {
  total_customers: string;
  avg_bookings: string | null;
  avg_revenue: string | null;
  avg_recency: number | null;
  male_count: string;
  female_count: string;
  whatsapp_reachable: string;
  email_reachable: string;
  sms_reachable: string;
}

export interface SegmentDefinitionRow {
  segment_id: number;
  segment_name: string;
  sql_criteria: string;
}

export interface StageSummaryRow {
  stage_number: number;
  stage_name: string;
  stage_color: string;
  customer_count: string;
  segment_count: string;
}

export interface ConversionMetricRow {
  conversion_type: string;
  conversions: string;
  total_value: string | null;
  source_channel: string;
  day: Date;
}
