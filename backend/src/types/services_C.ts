/**
 * Type-only definitions for GTMService, GiveawayJourneyService, JourneyStatsService,
 * JourneyTemplateQAService and SegmentEngine.
 */

/** One item inside a GTM ecommerce payload. */
export interface GtmEcommerceItem {
  item_id?: string | number | null;
  image_url?: string | null;
  currency?: string | null;
  [key: string]: unknown;
}

/** GTM ecommerce payload (ecommerceData). */
export interface GtmEcommerceData {
  items?: GtmEcommerceItem[];
  currency?: string | null;
  [key: string]: unknown;
}

/** Body accepted by GTMService.recordEvent (raw dataLayer push). */
export interface GtmEventBody {
  eventName?: string;
  customerId?: string | null;
  email?: string | null;
  sessionId?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  eventCategory?: string | null;
  eventAction?: string | null;
  eventLabel?: string | null;
  eventValue?: string | number | null;
  ecommerceData?: GtmEcommerceData | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  country?: string | null;
  city?: string | null;
  rid?: string | null;
  unifiedId?: string | null;
  journeyId?: string | null;
  nodeId?: string | null;
  name?: string | null;
  contactNumber?: string | null;
  itemId?: string | number | null;
  imageUrl?: string | null;
  currency?: string | null;
  [key: string]: unknown;
}

export interface GtmEventAnalyticsOpts {
  eventName?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface GtmExportOpts {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface SpecialOccasionInput {
  name?: string;
  occasionType?: string;
  startDate?: string;
  endDate?: string;
  targetMarkets?: string[] | string | null;
  discountCode?: string | null;
  campaignTheme?: string | null;
}

/** Input of GiveawayJourneyService.onEvent. */
export interface GiveawayEventInput {
  giveawayType?: string | null;
  unifiedId?: string | number | null;
  eventId?: string | number | null;
}

/** Journey node as read for stats display. */
export interface StatsNodeDef {
  id: string;
  type?: string;
  data?: { label?: string; title?: string; channel?: string | null; [key: string]: unknown };
}

export interface StatsNodeMeta {
  label: string;
  type: string;
  channel?: string | null;
}

/** Per-node metrics accumulated by JourneyStatsService. */
export interface NodeStatsRow {
  node_id: string;
  sent: number;
  entries: number;
  failed: number;
  sends_today: number;
  delivered: number;
  bounced: number;
  opened: number;
  human_opened: number;
  clicked: number;
  human_clicked: number;
  landed: number;
  gtm_events: number;
  unsubscribed: number;
  dist_snapshot: number;
  dist_active: number;
  dist_waiting: number;
  dist_completed: number;
  dist_exited_booked: number;
  dist_exited_unsub: number;
}

/** Per-node metrics for a single Dubai date (computeNodesForDate). */
export type DateNodeStatsRow = Omit<NodeStatsRow, 'sends_today' | 'dist_snapshot' | 'dist_active' | 'dist_waiting' | 'dist_completed' | 'dist_exited_booked' | 'dist_exited_unsub'>;

export type NodeStatsNumericKey = Exclude<keyof NodeStatsRow, 'node_id'>;

export interface SegmentCustomersOpts {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}
