/** Row types for U6 files (DataCleaningService, testE2E, UTMService, GupshupService, routes). */

export interface CustomerSegmentEnrichRow {
  [column: string]: unknown;
  email: string;
  full_name: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp_id: string | null;
  country: string | null;
  nationality: string | null;
  gender: string | null;
  phone_clean: string | null;
}

// ── routes/testE2E ──
export interface TestE2EContactRow { booking_status: string | null }
export interface TestE2ETemplateRow { id: number; name: string; html_template_id: number | null }
export interface TestE2ECampaignRow { id: number }
export interface TestE2EUtmRow { utm_id: number; full_url: string | null }
export interface TestE2EUserLinkRow { token: string }
export interface TestE2EEntryRow { entry_id: number }
export interface TestE2EJourneyRow { journey_id: number; name: string }
export interface TestE2ECampaignUtmRow { id: number; name: string; channel: string; utm_id: number; full_url: string | null }

// ── routes/giveaways ──
/** Optional body for POST /api/v3/giveaways/email/test. */
export interface GiveawayTestBody {
  id?: string;
  type?: string;
  name?: string;
  email?: string;
  tenantId?: string;
  giveawayId?: string;
  subject?: string;
  body?: string;
}

// ── routes/recommendations ──
export interface RecTemplateRow {
  id: number;
  subject: string | null;
  body: string | null;
  name: string;
  html_body: string | null;
}
/** Body of POST /api/v3/recommendations/test-send (fields read as-is; parseInt on the numeric ones). */
export interface RecTestSendBody {
  to?: string;
  city: string;
  templateId: string;
  excludeProductId?: string | number;
  topN: string;
  customerName?: string;
  destination?: string;
  emailHeading?: string;
  emailBody?: string;
  couponCode?: string;
  couponDiscount?: string;
  couponExpiry?: string;
}

// ── services/UTMService ──
/** Campaign ids / utm ids may be INTEGER or BIGINT depending on the table. */
export type UtmDbId = number | string;

export interface UtmCampaignRow {
  [column: string]: unknown;
  id: UtmDbId;
  name: string | null;
  segment_label: string | null;
  channel: string | null;
  template_id: UtmDbId | null;
  template_cta_url: string | null;
}
export interface UtmCampaignWithLinkRow extends UtmCampaignRow {
  utm_id: UtmDbId | null;
  utm_full_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}
export interface UtmIdRow { utm_id: UtmDbId }
export interface UtmSegmentLabelRow { segment_label: string }
export interface UtmSegmentListRow {
  segment_name: string;
  campaign_count: string;
  template_count: string;
  utm_count: string;
  total_clicks: string;
  total_conversions: string;
  total_revenue: string;
  customer_count: string;
}
export interface UtmTrackingRow {
  [column: string]: unknown;
  utm_id: UtmDbId;
  template_name: string | null;
  campaign_name: string | null;
  campaign_status: string | null;
  target_count: number | null;
}
export interface UtmChannelSummaryRow {
  channel: string | null;
  total_links: string;
  total_clicks: string | null;
  total_conversions: string | null;
  total_revenue: string | null;
}
export interface UtmSegmentSummaryRow {
  segment_label: string | null;
  total_links: string;
  total_clicks: string | null;
  total_conversions: string | null;
  campaigns_tracked: string;
}
/** unified_contacts.unified_id is BIGINT → string. */
export interface UtmCustomerRow { unified_id: string; name: string | null; email: string }
export interface UserUtmLinkRow {
  [column: string]: unknown;
  utm_id: UtmDbId | null;
  token: string;
  destination_url: string;
}
export interface UserUtmLinkListRow extends UserUtmLinkRow {
  campaign_name: string | null;
  segment_label: string | null;
  channel: string | null;
}
export interface UserUtmLinkStatsRow {
  total_links: string;
  clicked_links: string;
  total_clicks: string | null;
  campaigns: string;
}
export interface UserUtmCampaignStatsRow {
  campaign_id: UtmDbId;
  campaign_name: string | null;
  segment_label: string | null;
  channel: string | null;
  total_links: string;
  clicked: string;
  total_clicks: string | null;
  first_click: Date | null;
  last_click: Date | null;
}
export interface UserUtmTotalsRow {
  total_links: string;
  total_clicked: string;
  total_clicks: string | null;
  campaigns: string;
  unique_users: string;
}

// ── services/GupshupService (external API responses; only the fields the code reads) ──
export interface GupshupRcsTemplateListItem {
  name: string;
  gsTemplateId?: string | null;
  templateId?: string | null;
  status?: string | null;
  templateType?: string | null;
  lastUpdate?: string | null;
}
export interface GupshupRcsTemplateListResponse {
  status?: string | number;
  message?: string;
  data?: GupshupRcsTemplateListItem[];
  totalPages?: number | string;
}
export interface GupshupRcsSuggestion {
  displayText?: string;
  url?: string;
  postback?: string;
  suggestionType?: string;
}
export interface GupshupRcsCarouselCard {
  textMessageContent?: string;
  cardTitle?: string;
  cardDescription?: string;
  mediaUrl?: string;
  suggestions?: GupshupRcsSuggestion[];
}
export interface GupshupRcsTemplateDetailResponse {
  templateDetails?: {
    name?: string;
    status?: string | null;
    templateType?: string | null;
    gsTemplateId?: string | null;
  };
  carouselDetails?: GupshupRcsCarouselCard[];
}
/** WhatsApp template submit / status / send responses. */
export interface GupshupWaResponse {
  status?: string;
  id?: string;
  messageId?: string;
  message?: string;
  template?: { id?: string; status?: string };
}
/** SMS / RCS enterprise API response. */
export interface GupshupEnterpriseResponse {
  response?: { status?: string; id?: string; details?: string };
  data?: { causeId?: string | null };
}
export interface TemplateApprovalEventRow {
  id: number;
  template_id: number;
  provider: string;
  event_type: string;
  previous_status: string | null;
  new_status: string | null;
  details: unknown;
  created_at: Date;
}
