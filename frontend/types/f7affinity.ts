// Booking-affinity API shapes read by app/(dashboard)/affinity (F7 conversion).
// Numeric aggregates may arrive as strings from pg, so the page always runs them through Number().
import type { Id } from './api';

type Num = number | string | null;

export interface AffinityCustomerInfo {
  unified_id: Id;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  country?: string | null;
  contact_type: string;
  is_bulk?: boolean;
  bookings_all?: Num;
  revenue_all?: Num;
  affinity_score?: Num;
  first_booking_date?: string | null;
  last_booking_date?: string | null;
  product_count: number;
}

export interface AffinityServiceRank {
  service: string;
  rank: number;
  bookings: Num;
  cancelled: number;
  revenue: Num;
  last_booking_date: string | null;
  affinity_score: Num;
}

export interface AffinityProductRank {
  product_key: string;
  product_name: string;
  rank: number;
  services?: string[];
  bookings: Num;
  last_booking_date: string | null;
  affinity_score: Num;
}

/** GET /api/v3/booking-affinity/customers/:id */
export interface ContactAffinity {
  customer: AffinityCustomerInfo | null;
  services: AffinityServiceRank[];
  products: AffinityProductRank[];
}

/** GET /api/v3/booking-affinity/summary (status may be patched to 'running' locally) */
export interface AffinitySummary {
  status?: string;
  builtAt?: string | null;
  lastError?: string | null;
  totalCustomers?: number;
  topService?: { service: string | null; customers?: number }[];
}

/** GET /api/v3/booking-affinity/top-products → data[] */
export interface AffinityTopProduct {
  product_key: string | null;
  product_name: string;
  customers?: number | null;
}

/** One row of GET /api/v3/booking-affinity/customers. Rank columns are service_1..3, product_1..3_name etc. */
export interface AffinityCustomerRow {
  [column: string]: string | number | boolean | null | undefined;
  unified_id: number;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  country?: string | null;
  contact_type: string;
  is_bulk?: boolean;
  bookings?: Num;
  bookings_all?: Num;
  last_booking_date?: string | null;
  affinity_score?: Num;
}

export interface AffinityCustomerList {
  total: number;
  customers: AffinityCustomerRow[];
}
