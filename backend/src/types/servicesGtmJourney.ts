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

/** giveaway_events row loaded by processJob. */
export interface GiveawayEventRow {
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
