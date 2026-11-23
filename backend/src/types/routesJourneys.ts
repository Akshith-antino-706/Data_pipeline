/** Types local to src/routes/journeys.ts. */
export type QueryParams = Record<string, string | undefined>;

export interface JourneyNodeData {
  channel?: string;
  templateId?: string | number;
  emailTemplateId?: string | number;
  [key: string]: unknown;
}

export interface JourneyNode {
  id: string;
  type?: string;
  data?: JourneyNodeData;
  [key: string]: unknown;
}

export interface DiagnoseCheck {
  ok?: boolean;
  error?: string | null;
  [key: string]: unknown;
}

export interface DiagnoseReport {
  db?: DiagnoseCheck;
  redis?: DiagnoseCheck;
  emailOverride?: { configured: boolean; value: string | null };
  emailApiTest?: DiagnoseCheck;
  recentEvents?: unknown[] | { error: string };
  journeys?: unknown[] | { error: string };
}

export interface GtmEventStat {
  event_count: number;
  unique_users: number;
  total_value: number;
}
