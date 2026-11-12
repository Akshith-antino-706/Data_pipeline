/** Types for src/utils/emailTracking.ts and src/utils/emailFrequencyCap.ts (type-only module). */

export interface ClickTrackingOptions {
  logId: number | string;
  baseUrl: string;
  campaign: string;
  content: string;
  source?: string;
  medium?: string;
  unifiedId?: number | string | null;
  journeyId?: number | string | null;
  nodeId?: string | null;
}

/** Recipient identity for the email / WhatsApp frequency caps. */
export interface CapTarget {
  unifiedId?: number | string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CapResult {
  allowed: boolean;
  count: number;
  capped: boolean;
  bypassed?: boolean;
}
