/** Error carrying an HTTP status code (set by services, read by route handlers). */
export type HttpError = Error & { status?: number };

export interface AuthUserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
}

export interface RefreshTokenRow {
  id: number;
  user_id: number;
  expires_at: Date | string;
  revoked: boolean;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
}

export interface BookingLookupRow {
  booking_id: number | string;
  product_id: string | null;
  product_name: string | null;
  travel_date: string | null;
  source_table: string;
  destination_city: string | null;
}

export interface BookingListRow {
  id: number | string;
  service_id: string | null;
  service_name: string | null;
  travel_date: string | null;
  city: string | null;
}

export interface CountRow {
  total?: string;
  count?: string;
}

export interface ListFilters {
  status?: string;
  channel?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ContentTemplateRow {
  id: number;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string;
  html_template_id: number | null;
  coupon_code?: string | null;
  [key: string]: unknown;
}

export interface ContentTemplateInput {
  name?: string;
  channel?: string;
  subject?: string;
  body?: string;
  bodyPlain?: string;
  mediaUrl?: string;
  ctaUrl?: string;
  ctaText?: string;
  variables?: unknown[];
  aiGenerated?: boolean;
  aiPrompt?: string;
  aiModel?: string;
  createdBy?: string | number;
}

export interface ContentTemplateUpdate {
  body?: unknown;
  subject?: unknown;
  [key: string]: unknown;
}

export interface TemplateCustomer {
  email?: string | null;
  full_name?: string | null;
  country?: string | null;
  nationality?: string | null;
  segment_label?: string | null;
  total_bookings?: number | string | null;
}

export interface CampaignRow {
  id: number;
  name: string;
  status: string;
  channel: string;
  segment_label: string;
  template_id: number;
  [key: string]: unknown;
}

export interface CampaignInput {
  name?: string;
  strategyId?: number | string;
  segmentLabel?: string;
  channel?: string;
  templateId?: number | string;
  filterCriteria?: Record<string, unknown>;
  scheduledAt?: string | null;
  createdBy?: string | number;
}

export interface CampaignCustomerRow extends TemplateCustomer {
  email: string;
}

export interface QueuedMessageRow {
  id: number;
  channel: string;
  customer_email: string;
  rendered_body: string;
  rendered_subject: string | null;
}

export interface SegmentEmailConfigEntry {
  baseTemplate?: string;
  subject?: string;
  email_heading?: string;
  email_body?: string;
  coupon_code?: string;
  coupon_discount?: string;
  coupon_expiry?: string;
  cta_url?: string;
  cta_text?: string;
}

export interface CampaignProduct {
  product_url: string;
  product_image: string;
  product_category: string;
  product_name: string;
  product_rating: string;
  product_reviews: string;
  product_price: string;
  product_strike_price: string;
}

export interface EnrichContactRow {
  id: number;
  email: string | null;
  mobile: string | null;
  country: string | null;
}

export interface EmailEnrichResult {
  actualEmail: string;
  enrichedEmail: string | null;
  markInvalid: boolean;
  wasFixed: boolean;
}

export interface InvalidEmailEntry {
  index: number;
  original: string;
  cleaned: string;
}
