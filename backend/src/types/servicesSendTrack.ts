/**
 * Type-only shapes for SendTrackService (email_send_log / whatsapp_send_log / utm_visits).
 */

export type LogId = number | string;
export type Id = number | string;

/** Arguments for SendTrackService.logSend (reserves a 'queued' email_send_log row). */
export interface LogSendArgs {
  unifiedId?: Id | null;
  email: string;
  contactName?: string | null;
  subject?: string | null;
  templateLabel?: string | null;
  dayNumber?: number | null;
  source?: string;
  journeyId?: Id | null;
  nodeId?: string | null;
}

/** A fully-formed row for SendTrackService.bufferLog (batched INSERT). */
export interface BufferedLogRow {
  id: LogId | undefined;
  unifiedId?: Id | null;
  email: string;
  contactName?: string | null;
  subject?: string | null;
  templateLabel?: string | null;
  dayNumber?: number | null;
  source?: string;
  journeyId?: Id | null;
  nodeId?: string | null;
  status?: string;
  externalId?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  error?: string | null;
  sentAt?: Date;
}

export interface MarkSentArgs {
  externalId?: string | null;
  provider?: string | null;
  durationMs?: number | null;
}

export interface MarkFailedArgs {
  error?: string | null;
  provider?: string | null;
  durationMs?: number | null;
}

/** UA / IP captured by the open/click tracking endpoints. */
export interface TrackingMeta {
  ua?: string | null;
  ip?: string | null;
}

export interface SendLogFilters {
  page?: number;
  limit?: number;
  status?: string;
  email?: string;
  dayNumber?: string | number;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  subscriptionStatus?: string;
  journeyId?: string | number;
  nodeId?: string;
  channel?: string;
}

export interface UtmVisitArgs {
  logId?: LogId | null;
  unifiedId?: Id | null;
  email?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  rid?: string | null;
  destinationUrl?: string | null;
}

export interface UtmSummaryFilters {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  /** Part of a campaign name. */
  q?: string;
}

export interface UtmLogFilters {
  page?: number;
  limit?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  email?: string;
  dateFrom?: string;
  dateTo?: string;
}
