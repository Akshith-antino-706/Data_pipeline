/** Content JSON parsed out of the Claude response in AIService.generateContent(). */
export interface U7AIGeneratedContent {
  subject?: string | null;
  body?: string;
  ctaText?: string;
  ctaUrl?: string;
  [key: string]: unknown;
}

/** customer_segments aggregate row used as AI prompt context. */
export type U7SegmentContextRow = {
  segment_label: string;
  size: string;
  avg_recency: string | null;
  avg_bookings: string | null;
  top_nationality: string | null;
  top_customer_type: string | null;
};

/** One element of the json_agg campaign_results in AIService.optimizeStrategy(). */
export interface U7CampaignResult {
  id: number;
  channel: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  bounced: number;
}

export interface U7StrategyWithResultsRow {
  campaign_results: (U7CampaignResult | null)[] | null;
  flow_steps: unknown[] | null;
  [col: string]: unknown;
}
