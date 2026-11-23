/** Row shapes for src/routes/journeys.ts (type-only module). */
import type { JourneyNode } from './routesJourneys.js';
import type { JourneyFlowNode } from './journeyService.js';

export interface JourneyStatsMetaRow {
  last_run_at: Date | null;
  last_run_ms: number | null;
  journeys_run: number | null;
}

export interface JourneyNodesRow {
  nodes: JourneyNode[] | null;
}

export interface JourneyNodesEdgesRow {
  nodes: JourneyNode[] | null;
  edges: unknown;
}

/** journey_node_stats.* — only node_id is read here. */
export interface JourneyNodeStatsRow {
  node_id: string;
  [key: string]: unknown;
}

export interface TestSendEntryRow {
  entry_id: number;
  customer_id: number;
  email: string;
  name: string | null;
}

export interface HtmlTemplateIdRow {
  html_template_id: number | null;
}

export interface ActiveEntryTimingRow {
  entry_id: number;
  current_node_id: string;
  last_event_at: Date | null;
  entered_at: Date | null;
}

export interface SnapshotStatusRow {
  journey_id: number;
  name: string;
  snapshot_count: number | null;
  status: string;
}

export interface CustomerIdRow {
  customer_id: number;
}

/** COUNT/SUM → string */
export interface GtmNodeEventRow {
  node_id: string;
  event_name: string;
  event_count: string;
  unique_users: string;
  total_value: string | null;
}

export interface NodeSentRow {
  node_id: string;
  sent_count: string;
}

export interface EventTypeTotalRow {
  event_name: string;
  journey_total: string;
}

export interface NodeConversionRow {
  node_id: string;
  node_start: Date | null;
  node_end: Date | null;
  total_openers: string;
  converted: string;
}

export interface JourneyIdRow {
  journey_id: number;
}

export interface EntryIdRow {
  entry_id: number;
}

export interface AddNodeBody {
  node: JourneyFlowNode;
  afterNodeId: string | null;
}

export interface ResetEntriesBody {
  nodeId?: string;
}
