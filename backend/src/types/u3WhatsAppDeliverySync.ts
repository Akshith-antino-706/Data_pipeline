// ChatHead broadcast report payloads + chathead_broadcasts row (type-only).

type NumLike = string | number | null | undefined;

export interface ChatHeadReportCounters {
  total?: NumLike;
  sent?: NumLike;
  failed?: NumLike;
  delivered?: NumLike;
  open?: NumLike;
  clicked?: NumLike;
  replied?: NumLike;
  soft_bounce?: NumLike;
  hard_bounce?: NumLike;
  complaints?: NumLike;
}

export interface ChatHeadReportGetResponse {
  status?: string;
  data?: ChatHeadReportCounters | null;
}

export interface ChatHeadReportListRow {
  number?: string | number | null;
  reason?: unknown;
}

export interface ChatHeadReportListResponse {
  data?: ChatHeadReportListRow[] | null;
}

export interface ChatHeadBroadcastCountersRow {
  total_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  delivered_count: number | null;
  opened_count: number | null;
  clicked_count: number | null;
  replied_count: number | null;
  soft_bounce: number | null;
  hard_bounce: number | null;
  complaints: number | null;
  counters_changed_at: Date | null;
}

export interface DeliveryCounters {
  total: number | null;
  sent: number | null;
  failed: number | null;
  delivered: number | null;
  opened: number | null;
  clicked: number | null;
  replied: number | null;
  soft: number | null;
  hard: number | null;
  complaints: number | null;
}
