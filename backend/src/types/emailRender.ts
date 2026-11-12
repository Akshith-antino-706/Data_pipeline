/**
 * Types for the email rendering services (type-only module):
 * EmailRenderer, BaseTemplateService, WelcomeEmailService, EmailQAService.
 */

/** Variable map handed to the {{var}} / Liquid passes. Values are coerced to strings at replace time. */
export type TemplateVars = Record<string, unknown>;

/** content_templates.* joined with email_html_templates (EmailRenderer.render / renderPreview). */
export interface ContentTemplateRow {
  id: number;
  subject: string | null;
  body: string | null;
  channel: string | null;
  segment_label: string | null;
  html_body: string | null;
  html_name: string | null;
  html_type?: string | null;
  html_category?: string | null;
  html_engine?: string | null;
  html_subject_line?: string | null;
}

/** Subset of unified_contacts used for personalization. */
export interface RenderContactRow {
  id?: number;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  actual_mobile?: string | null;
  country?: string | null;
  city?: string | null;
  booking_status?: string | null;
}

/** email_html_templates row read by renderForJourneyNode. */
export interface HtmlTemplateRow {
  id: number;
  name: string | null;
  html_body: string | null;
  preview_text: string | null;
  engine: string | null;
  subject_line: string | null;
  uses_popular_products: boolean | null;
  product_type: string | null;
  product_limit: number | null;
}

/** The slice of a GTM raw_payload that renderForJourneyNode reads. */
export interface RenderGtmEcomItem {
  item_name?: string;
  image_url?: string;
  city?: string;
  item_category?: string;
  price?: string | number | null;
}
export interface RenderGtmPayload {
  itemName?: string;
  pageUrl?: string;
  imageUrl?: string;
  city?: string;
  itemCategory?: string;
  eventValue?: string | number | null;
  ecommerceData?: { items?: RenderGtmEcomItem[]; value?: string | number | null } | null;
}
export interface RenderGtmEventRow {
  raw_payload: RenderGtmPayload | null;
  page_url: string | null;
}

/** Product card shape returned by ProductAffinityService.getTemplateProducts(). */
export interface TemplateProductCard {
  name?: string | null;
  price?: string | null;
  image?: string | null;
  url?: string | null;
  category?: string | null;
  reason?: string;
}
export interface TemplateProducts {
  primaryProduct: TemplateProductCard | null;
  recommendations: TemplateProductCard[];
}

/** popularity_snapshots row (PopularityService.getSnapshot groups these by theme). */
export interface PopularitySnapshotRow {
  theme: string | null;
  position: number;
  product_id: string | null;
  name: string | null;
  category: string | null;
  location: string | null;
  duration: string | null;
  price: string | null;
  image_url: string | null;
  product_url: string | null;
}
export type PopularitySnapshot = Map<string, PopularitySnapshotRow[]>;

/** Args for the SLOT expanders. */
export interface SlotExpandArgs {
  html: string;
  journeyId: number | string;
  nodeId: string;
  runId: string;
  fallbackProductType?: string | null;
  utmLink: string;
}
export interface SlotExpandResult {
  html: string;
  slotsFilled: number;
}

export interface RenderForJourneyNodeArgs {
  htmlTemplateId: number | string;
  unifiedId?: number | string | null;
  journeyId?: number | string | null;
  nodeId?: string | null;
  runId?: string | null;
  extraVars?: TemplateVars;
}

export interface BuildUtmLinkArgs {
  journeyId?: number | string | null;
  nodeId?: string | null;
  htmlTemplateName?: string | null;
  unifiedId?: number | string | null;
  base?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  plainText: string;
}

export interface RenderedEmailPreview {
  subject: string;
  html: string;
  htmlTemplateName: string | null;
  channel: string | null;
  segment: string | null;
}

// ── BaseTemplateService ──────────────────────────────────────────

export interface BaseTemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail: string;
  subject: string;
  hasProducts: boolean;
  hasCoupon: boolean;
  variables: string[];
  bestFor: string[];
}

export type BaseTemplateProduct = Record<string, unknown>;

/** Render data: top-level {{vars}} plus an optional products[] for {{#products}} blocks. */
export interface BaseTemplateData {
  products?: BaseTemplateProduct[];
  [key: string]: unknown;
}

export interface SegmentEmailConfig {
  baseTemplate: string;
  subject: string;
  email_heading: string;
  email_body: string;
  coupon_code?: string;
  coupon_discount?: string;
  coupon_expiry?: string;
  cta_url?: string;
  cta_text?: string;
  urgency_icon?: string;
  urgency_text?: string;
}

// ── WelcomeEmailService ──────────────────────────────────────────

export interface WelcomeContactRow {
  id: number;
  email: string | null;
  name: string | null;
  email_unsubscribe: string | null;
}

export interface WelcomeEventPayload {
  itemName?: string;
  pageUrl?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface WelcomeEventInfo {
  eventName?: string | null;
  eventId?: string | number | null;
  payload?: WelcomeEventPayload;
  pageUrl?: string | null;
  createdAt?: Date | string | null;
}

// ── EmailQAService ───────────────────────────────────────────────

export interface UrlCheckResult {
  url: string;
  status: number;
  ok: boolean;
  finalUrl?: string;
  error?: string;
}

export interface SpamRiskResult {
  level: 'High' | 'Medium' | 'Low';
  likelyPlacement: string;
  score: number;
  reasons: string[];
}

export interface ClaudeQAAnalysis {
  grammar: string[];
  missingContent: string[];
  errors: string[];
  source: 'no_api_key' | 'claude' | 'fallback';
}

export interface ClaudeMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}

export interface InboxPlacementHit {
  subject: string | undefined;
  from: string;
  date: Date | undefined;
}

export interface InboxPlacementResult {
  available: boolean;
  placement?: 'inbox' | 'spam' | 'not_found';
  subject?: string;
  foundAt?: Date;
  note?: string;
  error?: string;
}
