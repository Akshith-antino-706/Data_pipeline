/** Row of test_segment_schedule (SELECT * / RETURNING *). */
export interface U7TestSegmentScheduleRow {
  id: number;
  is_running: boolean;
  started_at: Date | null;
  next_day_to_send: number;
  last_sent_day: number | null;
  last_sent_at: Date | null;
  destination_key: string | null;
  loop: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  emails: string[] | null;
}

/** JSON body of POST /api/v3/test-sends/prewarm (or {} on parse failure). */
export interface U7PrewarmResponse {
  data?: { summary?: unknown; ready?: number };
}

/** JSON body of POST /api/v3/test-sends/dayN (or {} on parse failure). */
export interface U7DaySendResponse {
  error?: string;
  data?: {
    async?: boolean;
    results?: { success?: boolean }[];
    recipients?: number;
    jobId?: unknown;
    ranking?: { source?: unknown };
  };
}
