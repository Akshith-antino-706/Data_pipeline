/** Types for src/utils/reviewUrl.ts (type-only module). */

/** One row of the latest-bill booking query (travel_date is TEXT YYYY-MM-DD). */
export interface ReviewBookingRow {
  bill_no: string;
  bill_type: string | null;
  service_name: string;
  travel_date: string | null;
}

export interface ReviewContactRow {
  name: string | null;
  email: string | null;
  contact_type: string | null;
}
