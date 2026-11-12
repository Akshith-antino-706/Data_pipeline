/**
 * Row types for UnifiedContactService queries (pg: COUNT/NUMERIC/BIGINT → string,
 * ::int → number, TIMESTAMPTZ → Date).
 */

/** COUNT(*) without a cast (bigint → string). */
export interface U7CountTextRow { total: string }
/** COUNT(*)::int. */
export interface U7CountIntRow { total: number }

/** A unified_contacts row (SELECT * / RETURNING *); getById also attaches extra fields. */
export interface U7UnifiedContactRow {
  id: string | number;
  [col: string]: unknown;
}

/** Contact list row (getAll / getSegmentCustomers). */
export interface U7ContactListRow {
  id: string | number;
  email: string | null;
  mobile: string | null;
  name: string | null;
  country: string | null;
  city: string | null;
  sources: string | null;
  contact_type: string | null;
  wa_unsubscribe: string | null;
  email_unsubscribe: string | null;
  booking_status: string | null;
  product_tier: string | null;
  geography: string | null;
  is_indian: boolean | null;
  segments: unknown;
  created_at: Date | null;
  updated_at: Date | null;
  total_tour_bookings?: number;
  total_package_bookings?: number;
  total_hotel_bookings?: number;
  total_visa_bookings?: number;
  total_other_bookings?: number;
  total_flight_bookings?: number;
  total_booking_revenue: string;
}

export interface U7ContactBookingStatsRow {
  tour_rev: string; pkg_rev: string; htl_rev: string; vis_rev: string; oth_rev: string; flt_rev: string;
  tour_cnt: number;
  pkg_cnt: number;
  htl_cnt: number;
  vis_cnt: number;
  oth_cnt: number;
  flt_cnt: number;
  revenue: string;
  cancelled_cnt: number;
  cancelled_revenue: string;
}

export interface U7BookingDetailRow {
  bill_serial: unknown;
  bill_no: unknown;
  bill_type: unknown;
  service_id: unknown;
  travel_date: string | null;
  service_name: string | null;
  selling_price: unknown;
  is_cancel: string | null;
  guest_name: string | null;
  nationality: string | null;
  booking_date: string | null;
}

export interface U7DeletedIdRow { id: string | number }
export interface U7CountryCountRow { country: string; cnt: number }
export interface U7BookingStatusRow { booking_status: string }
export interface U7ProductTierRow { product_tier: string }
export interface U7GeographyRow { geography: string }

export interface U7ContactStatsRow {
  total_contacts: number;
  with_travel: number;
  multi_source: number;
  countries: number;
}
export interface U7RevenueTotalsRow { total_revenue: string | null; total_bookings: number | null }
export interface U7Conversations7dRow { conversations_7d: number }

export interface U7TreeSnapshotRow {
  total_contacts: number;
  segment_count: number;
  total_revenue: string;
  status_counts: unknown;
  breakdown: unknown;
  revenue_by_type: unknown;
}

export interface U7StatusBookingBreakdown {
  tours: number;
  tours_revenue: number;
  packages: number;
  packages_revenue: number;
  hotels: number;
  hotels_revenue: number;
  visas: number;
  visas_revenue: number;
  others: number;
  others_revenue: number;
}

/**
 * Per-booking_status row. `revenue` arrives from pg as a NUMERIC string (or is absent)
 * and is overwritten in place with a parsed number — typed as the post-merge number.
 */
export interface U7StatusCountRow {
  booking_status: string;
  count: number;
  indian_count: number;
  revenue?: number;
  total_bookings?: number;
  booking_breakdown?: U7StatusBookingBreakdown;
}

export interface U7SegmentBreakdownRow {
  booking_status: string | null;
  product_tier: string | null;
  geography: string | null;
  count: number;
  indian_count: number;
  revenue: string;
}

/** Totals row; total_revenue is attached after the query. */
export interface U7TreeTotalsRow {
  total: number;
  segmented: number;
  segment_count: number;
  total_revenue?: number;
}

export interface U7RevenueBySourceRow { source: string; bookings: number; revenue: string }
export interface U7RevenueByStatusRow { booking_status: string; revenue: string }

export interface U7SegmentCountRow { segment_label: string; total_count: number }
export interface U7SegmentRevenueRow { segment_label: string; revenue: string }
export interface U7SegmentCountRevenueRow { segment_label: string; total_count: number; revenue: string }

export interface U7SegmentDailyLogRow {
  log_date: string;
  segment_label: string;
  total_count: number;
  entered: number;
  exited: number;
  converted: number;
  emails_sent: number;
  whatsapp_sent: number;
  push_sent: number;
  total_reached: number;
  journey_active: number;
  journey_completed: number;
  revenue: string;
  snapshot_time: Date | null;
  [col: string]: unknown;
}

export interface U7SnapshotTimeRow { snapshot_time: Date }

/** Per-status revenue row (travel-window variant); NUMERIC `revenue` is parsed to a number in place. */
export interface U7StatusRevenueRow {
  booking_status: string;
  count: number;
  indian_count: number;
  revenue: number;
}
