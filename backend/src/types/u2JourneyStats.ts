import type { StatsNodeDef } from './services_C.js';

/** Per-node aggregate row: node_id plus COUNT columns (pg returns bigint COUNT as string). */
export type U2NodeCountRow<K extends string> = { node_id: string } & { [P in K]: string };

/** Per-node entry distribution row (::int casts → number; node_id may be NULL). */
export type U2DistRow = {
  node_id: string | null;
  dist_snapshot: number;
  dist_active: number;
  dist_waiting: number;
  dist_completed: number;
  dist_exited_unsub: number;
  dist_exited_booked: number;
};

/** journey_flows shell read by refreshJourney / computeNodesForDate. */
export interface U2JourneyFlowShell {
  journey_id: string;
  name: string;
  status: string;
  journey_type: string | null;
  nodes: StatsNodeDef[] | null;
}

/** Journey-level lifecycle totals (all ::int). */
export interface U2LifecycleTotals {
  entries: number;
  booked: number;
  exited_booked: number;
  exited_unsub: number;
}

/** Row of the stalest-first journey list in refreshAllJourneys. */
export interface U2JourneyStalenessRow {
  journey_id: string;
  status: string;
  computed_at: Date | null;
}
