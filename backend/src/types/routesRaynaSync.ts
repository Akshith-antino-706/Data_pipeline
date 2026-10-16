import type { QueryResultRow } from 'pg';

/** One cron card on the Rayna-sync mapping-stats screen. */
export interface CronJobCard {
  name: string;
  label: string;
  category: 'ingest' | 'compute' | 'engine';
  schedule: string;
  humanSchedule: string;
  description: string;
  /** sync_metadata row (or an aggregate of several); null when the cron doesn't write one. */
  meta: QueryResultRow | null;
  sourceLatestAt?: unknown;
  sourceLabel?: string;
  nextRun?: string | null;
}
