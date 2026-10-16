/** Types for ContinuousJourneyService (continuous GTM journey engine). */
import type { JourneyNode } from './queueJobs.js';

export interface ContinuousEnterInput {
  journeyId: number | string;
  unifiedId: number | string;
  itemId?: string | number;
  eventId?: string | number | null;
  serviceType?: string | null;
  firstNodeId: string;
  entryDelayMs?: number;
}

/** gtm_journey_entries row as claimed by processDue(). */
export interface ContinuousDueRow {
  id: number;
  journey_id: number;
  unified_id: string;
  item_id: string;
  current_node_id: string;
  last_event_id: string | null;
}

/** Journey node with the WhatsApp action fields the continuous engine reads. */
export interface ContinuousWaNode extends JourneyNode {
  data?: {
    track?: string;
    channel?: string;
    waChannelId?: string | number;
    waTemplateId?: string | number;
    waChannelName?: string;
    waTemplateName?: string;
    [key: string]: unknown;
  };
}

export interface ContinuousWaGroup {
  node: ContinuousWaNode;
  waCh: string | number | undefined;
  waTpl: string | number | undefined;
  entries: ContinuousDueRow[];
}

/** unified_contacts columns fetched for a WhatsApp group. */
export interface ContinuousContactRow {
  id: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  wa_unsubscribe: string | null;
}

export interface ContinuousWaRecipient {
  e: ContinuousDueRow;
  c: Partial<ContinuousContactRow>;
  phone: string;
}
