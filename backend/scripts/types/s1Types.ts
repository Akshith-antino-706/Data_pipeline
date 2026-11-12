/** Shared type-only helpers for one-off scripts (S1 batch). */

/** Loose journey_flows.nodes element as read by the smoke/test scripts. */
export interface S1FlowNode {
  id: string;
  type?: string;
  data?: {
    templateId?: string;
    waitDays?: number;
    channel?: string;
    waChannelId?: string;
    waTemplateId?: string | number;
    waTemplateName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** popularity_snapshots.raw_payload (JSONB) audit fields read by inspect scripts. */
export interface S1SnapshotRawPayload {
  ranked_by?: string;
  model?: string;
  queries?: string[];
  sources?: { url: string }[];
  [key: string]: unknown;
}
