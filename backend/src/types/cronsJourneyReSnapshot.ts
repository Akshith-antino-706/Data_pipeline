/** journey_flows row selected by the daily journey re-snapshot cron. */
export interface ReSnapshotJourneyRow {
  journey_id: number;
  name: string;
  recommendation_type: string | null;
  segment_id: number | null;
  custom_segment_id: number | null;
  audience: string | null;
  nodes: { id?: string }[] | null;
}
