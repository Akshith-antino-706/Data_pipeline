// Row / payload shapes used by routes/unifiedContacts.ts (type-only).

export interface SourceCountRow {
  source: string;
  count: number;
}

export interface SegmentDailyLogCsvRow {
  log_date: Date | string | null;
  segment_label: string;
  total_count: unknown;
  entered: unknown;
  exited: unknown;
  converted: unknown;
  emails_sent: unknown;
  whatsapp_sent: unknown;
  push_sent: unknown;
  total_reached: unknown;
  journey_active: unknown;
  journey_completed: unknown;
  revenue: unknown;
}

export interface SegmentCustomerCsvRow {
  name: string | null;
  email: string | null;
  mobile: string | null;
  country: string | null;
  contact_type: string | null;
  booking_status: string | null;
  product_tier: string | null;
  geography: string | null;
  sources: string | null;
}

export interface UserProductRecommendationRow {
  unified_id: number;
  recommendation_type: string;
  based_on_booking_id: string | null;
  based_on_product_id: string | number | null;
  destination_city: string | null;
  product_ids: unknown;
  source: string | null;
  rationale: string | null;
  computed_at: Date;
  expires_at: Date;
}

export interface RecommendedProductRow {
  product_id: number;
  name: string;
  category: string | null;
  city: string | null;
  image: string | null;
  url: string | null;
  sale_price: string | null;
  normal_price: string | null;
  listing_rating: string | null;
}

export interface NodeEngagement {
  node_id: string;
  label: string | null;
  subject: string | null;
  day_number: number | null;
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  sent_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
}

export interface NodeEngagementRow {
  journey_id: number;
  node_id: string;
  label: string | null;
  subject: string | null;
  day_number: number | null;
  delivered: string;
  opened: string;
  clicked: string;
  sent_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
}

export interface ContactJourneyRow {
  journey_id: number;
  name: string;
  journey_status: string;
  entry_status: string;
  exit_reason: string | null;
  current_node_id: string | null;
  entered_at: Date | null;
  completed_at: Date | null;
  nodes?: NodeEngagement[];
}
