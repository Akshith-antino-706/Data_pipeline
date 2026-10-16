/** Shapes for the /api/health response built in server.ts. */
export interface HealthCheckStatus {
  status: string;
  error?: string;
  latencyMs?: number;
  httpStatus?: number | null;
  queues?: Record<string, Record<string, number> | null>;
  email?: string;
  whatsapp?: string;
  sms?: string;
  journeys?: { active: number; paused: number; completed: number };
  entries?: { active: number; completed: number; converted: number };
}

export interface HealthChecks {
  postgres?: HealthCheckStatus;
  redis?: HealthCheckStatus;
  bullmq?: HealthCheckStatus;
  emailApi?: HealthCheckStatus;
  workers?: HealthCheckStatus;
  journeyEngine?: HealthCheckStatus;
}

export interface JourneyFlowCountsRow {
  active_journeys: string;
  paused_journeys: string;
  completed_journeys: string;
}

export interface JourneyEntryCountsRow {
  active_entries: string;
  completed_entries: string;
  converted_entries: string;
}

export interface EmailSendLogContextRow {
  unified_id?: string | null;
  email?: string | null;
  journey_id?: number | null;
  node_id?: string | null;
}

export interface UtmParams {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  rid?: string | null;
}

/** Error shape seen by the Express error handler. */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}
