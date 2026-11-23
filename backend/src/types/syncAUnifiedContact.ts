/** Types for services/UnifiedContactService.ts (type-only). */

export interface UnifiedContactListFilters {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  source?: string;
  country?: string;
  contactType?: string | null;
  businessType?: string | null;
  bookingStatus?: string;
  productTier?: string;
  geography?: string;
  hasBookings?: string;
  waStatus?: string;
  emailStatus?: string;
  bookingDateFrom?: string;
  bookingDateTo?: string;
  travelDateFrom?: string;
  travelDateTo?: string;
}

export interface UnifiedContactFields {
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  city?: string | null;
  country?: string | null;
  contact_type?: string | null;
  geography?: string | null;
  wa_unsubscribe?: string | null;
  email_unsubscribe?: string | null;
  [key: string]: unknown;
}

export interface BusinessTypeFilter {
  businessType?: string | null;
}

export interface SegmentationTreeFilters extends BusinessTypeFilter {
  dateFrom?: string;
  dateTo?: string;
  travelFrom?: string;
  travelTo?: string;
  bookingFrom?: string;
  bookingTo?: string;
  product?: string;
}

export interface SegmentDailyLogFilters extends BusinessTypeFilter {
  days?: number;
  segment?: string;
}

export interface SegmentCustomerFilters extends BusinessTypeFilter {
  bookingStatus?: string;
  productTier?: string;
  geography?: string;
  page?: number;
  limit?: number;
  search?: string;
}

/** One row of per-product booking counts (COUNT::int) and revenue (numeric → string). */
export interface BookingBreakdownRow {
  tours?: number;
  tours_revenue: string;
  packages?: number;
  packages_revenue: string;
  hotels?: number;
  hotels_revenue: string;
  visas?: number;
  visas_revenue: string;
  others?: number;
  others_revenue: string;
}
