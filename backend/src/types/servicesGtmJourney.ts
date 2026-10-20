/**
 * Type-only shapes for GtmJourneyService (event-triggered / continuous journeys).
 */
import type { JourneyEdge, JourneyNode } from './queueJobs.js';
import type { PlaceholderContact } from './utilsPlaceholder.js';

/** Action-node data fields GtmJourneyService reads from journey_flows.nodes. */
export interface GtmActionNodeData {
  track?: string;
  channel?: string;
  waitDays?: string | number;
  waChannelId?: string;
  waChannelName?: string | null;
  waTemplateId?: string;
  waTemplateName?: string | null;
  rcsTemplateCode?: string;
  emailTemplateId?: string | number | null;
  templateId?: string | number | null;
  [key: string]: unknown;
}

export interface GtmFlowNode extends JourneyNode {
  data?: GtmActionNodeData;
}

/** journey_flows row selected by onEvent. */
export interface GtmJourneyFlowRow {
  journey_id: number;
  nodes: GtmFlowNode[] | null;
  edges: JourneyEdge[] | null;
  custom_segment_id: number | null;
  segment_id: number | null;
  audience: string | null;
}

export interface GtmOnEventArgs {
  eventName?: string | null;
  unifiedId?: string | number | null;
  eventId?: string | number | null;
  itemId?: string | number | null;
}

/** One pre-resolved (user x item) row for enqueueForStart. */
export interface GtmStartRow {
  unifiedId: string | number;
  eventId?: string | number | null;
  itemId?: string | number | null;
}

export interface GtmNextStep {
  nodeId: string;
  delayMs: number;
}

/** unified_contacts row loaded by processJob. */
export interface GtmContactRow extends PlaceholderContact {
  id: number;
  email: string | null;
  email_unsubscribe?: string | null;
  wa_unsubscribe?: string | null;
}

/**
 * The producer's original message as stored in giveaway_affiliate_events.raw_payload.
 * Only the nested affiliate blocks are read directly (handed to Liquid as-is).
 */
export interface GiveawayAffiliatePayload {
  to?: Record<string, unknown>;
  coupon?: Record<string, unknown>;
  commission?: Record<string, unknown>;
  link?: Record<string, unknown>;
  cardOffer?: Record<string, unknown>;
  [key: string]: unknown;
}

/** giveaway_affiliate_events row loaded by processJob (giveaway AND affiliate feeds). */
export interface GiveawayEventRow {
  source?: 'GIVEAWAY' | 'AFFILIATE' | string | null;
  raw_payload?: GiveawayAffiliatePayload | null;
  // ── affiliate-specific columns (null for giveaway rows) ──
  coupon_id?: string | null;
  valid_from?: Date | string | null;          // TIMESTAMPTZ
  max_per_user?: number | null;
  discount_type?: string | null;
  max_discount_value?: string | number | null; // NUMERIC → string from pg
  currency?: string | null;
  commission_rate?: string | number | null;
  commission_prev_rate?: string | number | null;
  effective_from?: Date | string | null;      // TIMESTAMPTZ
  link_slug?: string | null;
  tracking_url?: string | null;
  destination_url?: string | null;
  campaign_source?: string | null;
  campaign_medium?: string | null;
  campaign_name?: string | null;
  offer_subtitle?: string | null;
  bank_name?: string | null;
  min_order_value?: string | number | null;
  max_discount_cap?: string | number | null;
  // ── giveaway columns (some shared with affiliate: value, code, offer, offer_code, expiry) ──
  name?: string | null;
  giveaway?: string | null;
  giveaway_image?: string | null;
  mechanic?: string | null;
  prize?: string | null;
  prize_image?: string | null;
  prize_type?: string | null;
  value?: string | number | null;
  rank?: string | number | null;
  code?: string | null;
  offer?: string | null;
  offer_code?: string | null;
  expiry?: string | null;
  position?: string | number | null;
  points?: string | number | null;
}

/** Optional diagnostics some injectPerUserProducts branches return. */
export interface InjectedRecMeta {
  source?: string;
  fromCache?: boolean;
}
