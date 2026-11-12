// Shapes read by the segmentation pages (F7 conversion). Fields mirror the backend JSON.
import type { Id } from './api';
import type { SegmentCondition } from './f2Segments';

/** A row of GET /api/v3/custom-segments (custom_segments table). */
export interface CustomSegment {
  id: Id;
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  cached_count?: number | null;
  conditions?: Partial<SegmentCondition>[];
  created_at: string;
}

// ── Decision-tree segmentation (GET /api/v3/segments/tree etc.) ──
import type { BookingStatus, Geography, ProductTier } from '../lib/segmentSlug';

/** One (status, tier, geography) row of the segmentation tree breakdown. */
export interface SegmentBreakdownRow {
  booking_status: BookingStatus | null;
  product_tier: ProductTier | null;
  geography: Geography | null;
  count: number;
  revenue: number | string;
  indian_count: number;
  total_tours: number;
  total_hotels: number;
  total_visas: number;
  total_flights: number;
}

/** Per-type booking counts (`tours`) and revenue (`tours_revenue`, pg numeric → string). */
export type BookingBreakdown = Record<string, number | string>;

export interface SegmentStatusCount {
  booking_status: string;
  count: number;
  revenue: number | string;
  total_bookings?: number | null;
  booking_breakdown?: BookingBreakdown;
}

export interface SegmentRevenueSource {
  source: string;
  bookings: number;
  revenue: number | string;
}

export interface SegmentTree {
  totals?: { total: number; segmented: number; segment_count: number };
  statusCounts?: SegmentStatusCount[];
  breakdown?: SegmentBreakdownRow[];
  revenueByType?: { total?: number | string; sources?: SegmentRevenueSource[] };
}

export interface GeneralSegmentSummary {
  totalContacts: number;
  emailEligible: number;
  waEligible: number;
}

/** A booking row inside a unified contact's rayna_* arrays. */
export interface ContactBookingRow {
  service_name?: string | null;
  guest_name?: string | null;
  bill_no?: string | number | null;
  selling_price: string;
  is_cancel?: string | null;
  status?: string | null;
  travel_date?: string | null;
  bill_date?: string | null;
  booking_date?: string | null;
}

export type ContactBookingListKey = 'rayna_tours' | 'rayna_packages' | 'rayna_hotels' | 'rayna_visas' | 'rayna_others' | 'rayna_flights';
export type ContactBookingCountKey = 'total_tour_bookings' | 'total_package_bookings' | 'total_hotel_bookings' | 'total_visa_bookings' | 'total_other_bookings' | 'total_flight_bookings';

/** GET /api/v3/unified-contacts/:id → data (only the fields the segmentation modal reads). */
export type SegmentContactDetail = {
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  country?: string | null;
  booking_status?: string | null;
  contact_type?: string | null;
  product_tier?: string | null;
  is_indian?: boolean | null;
  total_booking_revenue?: number | string | null;
} & Partial<Record<ContactBookingListKey, ContactBookingRow[]>> & Partial<Record<ContactBookingCountKey, number>>;
