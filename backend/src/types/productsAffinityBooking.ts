/** Types for src/services/BookingAffinityService.ts (type-only module). */

/** Query-string filters accepted by the booking-affinity endpoints. */
export interface BookingAffinityFilters {
  businessType?: unknown;
  excludeBulk?: boolean | string | null;
  period?: string;
  view?: string | null;
  service?: string | null;
  product?: string | null;
  search?: string | null;
  sort?: string;
  limit?: string | number;
  page?: string | number;
}

export interface BookingAffinityWhere {
  sql: string;
  params: unknown[];
}

export interface BookingAffinityStatusOpts {
  startedAt: Date;
  rows?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface SyncMetaRow {
  last_synced_at: Date | null;
  rows_synced: number | null;
  sync_status: string | null;
  error_message: string | null;
  sync_duration_ms: number | null;
}

export interface BookingAffinityStatus {
  builtAt: Date | null;
  status: string | null;
  lastRunAt: Date | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

export interface BookingAffinityBuildResult {
  customers: number | null;
  serviceRows: number | null;
  productRows: number | null;
  groupedPct: number;
  excludedPct: number;
  topUngrouped: UngroupedProductRow[];
  asOf: string;
  duration: string;
}

export interface UngroupedProductRow {
  product_key: string;
  bookings: number;
}

export interface CoverageRow {
  grouped_pct: string | null;
  excluded_pct: string | null;
}

export interface TopProductRow {
  product_key: string;
  product_name: string;
  customers: number;
}

export interface AffinityProductRow {
  product_key: string;
  product_name: string;
  services: string[];
  customers_rank1: number;
  customers_top3: number;
  customers_any: number;
  bookings: number;
}

/** user_affinity_top3 row (dynamic bookings_* / service_N* / product_N* columns). */
export type AffinityTop3Row = Record<string, unknown>;
export type AffinityDetailRow = Record<string, unknown>;
