/** Request/row shapes local to src/routes/testSends.ts. */
import type { Request } from 'express';

/** Union of every JSON body field the test-send POST routes read. */
export interface U4TestSendBody {
  emails?: string[];
  templateId: string;
  source?: string;
  subject?: string;
  journeyId?: number | null;
  nodeId?: string | null;
  noClaude?: boolean;
  destinationKey?: string;
  loop?: boolean;
  email?: string;
}

export type U4TestSendRequest = Request<Record<string, string>, unknown, U4TestSendBody>;

export interface U4ContentTemplateBodyRow {
  subject: string | null;
  body: string | null;
  html_template_id: number | null;
}

export interface U4EmailHtmlTemplateRow {
  html_body: string | null;
  subject_line: string | null;
}

export interface U4ContentTemplateFullRow extends U4ContentTemplateBodyRow {
  id: number;
  name: string;
  channel: string;
  status: string;
}

export interface U4ValRow { val: string }
export interface U4CountryRow { val: string; cnt: number }
export interface U4IdNameRow { id: number; name: string }
/** reltuples::bigint → string; COUNT(*)::int → number. */
export interface U4TotalRow { total: string | number | null }

export interface U4ContactListRow {
  id: number;
  email: string;
  name: string | null;
  contact_type: string | null;
  booking_status: string | null;
  country: string | null;
  is_indian: boolean | null;
}

export interface U4ContactSearchRow {
  id: number;
  email: string;
  name: string | null;
  contact_type: string | null;
  rank: number;
}

export interface U4QaReportRow {
  report: Record<string, unknown> | null;
  placement: unknown;
  updated_at: Date;
}

/** email_send_log rows returned as-is to the UI. */
export type U4SendLogRow = Record<string, unknown>;
