// Shapes read by app/(dashboard)/test-sends/scheduler (F7 conversion).
import type { Id, SendLogRow } from './api';

/** One contact row of GET /api/v3/test-sends/contacts → contacts[] */
export interface TestSendContact {
  id?: Id;
  email: string;
  name?: string | null;
  contact_type?: string | null;
  booking_status?: string | null;
  country?: string | null;
}

export interface TestSendContactsPage {
  contacts?: TestSendContact[];
  total?: number;
}

export interface FilterOptionObj { val: string; label: string }

/** GET /api/v3/test-sends/contacts/filter-options */
export interface TestSendFilterOptions {
  booking_status?: string[];
  contact_type?: string[];
  countries?: { val: string }[];
  geography?: string[];
  product_tier?: string[];
  segments?: { id: Id; name: string }[];
  custom_segments?: { id: Id; name: string }[];
}

export type TestSendFilters = Record<string, string>;

export interface PrewarmState {
  status?: string;
  readyCount?: number;
  error?: string;
  summary?: { day: number; status: string }[];
}

/** One mail schedule from /api/v3/test-sends/schedule/* */
export interface MailSchedule {
  id: Id;
  is_running?: boolean;
  prewarm?: PrewarmState;
  emails?: string[];
  started_at?: string | null;
  last_sent_day?: number | null;
  last_sent_at?: string | null;
  next_day_to_send?: number | null;
}

/** POST /api/v3/test-sends/schedule/:id/tick */
export interface ScheduleTickResult {
  skipped?: boolean;
  reason?: string;
  day?: number;
  label?: string;
  sentTo?: number | string;
  sequenceDone?: boolean;
}

export interface ScheduleLogModal {
  id: Id;
  rows: SendLogRow[];
  loading: boolean;
}

// lucide-react forwards extra props to the <svg>; the page sets a `title` tooltip on an icon.
declare module 'lucide-react' {
  interface LucideProps {
    title?: string;
  }
}
