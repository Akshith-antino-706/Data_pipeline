// Types for scripts/e2e_journey_test.ts (API responses + query rows).

export interface S2ApiNode {
  id: string;
  type?: string;
  data?: {
    label?: string;
    channel?: string;
    templateId?: number | null;
    [key: string]: unknown;
  };
}

export interface S2ApiJson {
  data?: {
    journey_id?: number;
    nodes?: S2ApiNode[];
    // GET /journeys returns an array of journey rows under `data`
    [index: number]: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface S2SendResult {
  success?: boolean;
  provider?: string;
  [key: string]: unknown;
}

export interface S2EventDetails {
  autoPaired?: boolean;
  originalChannel?: string;
  sendResult?: S2SendResult;
  [key: string]: unknown;
}

export interface S2EventRow {
  customer_id: number;
  track: string | null;
  channel: string | null;
  details: S2EventDetails | null;
}

export interface S2FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface S2FlowRow {
  nodes: { id: string }[];
  edges: S2FlowEdge[];
}
