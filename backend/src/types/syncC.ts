import type { RowDataPacket } from 'mysql2/promise';

/** Shared sync_metadata write payload (PhpAdminWeeklySync / WhatsAppUnsubscribeSyncService). */
export interface SyncMetadataWrite {
  rowsSynced: number;
  durationMs: number;
  status: string;
  error: string | null;
  watermarkAdvance: Date;
}

export interface PhpAdminContactRow extends RowDataPacket {
  id: number;
  contact_type: string | null;
  name: string | null;
  email: string;
  mobile: string | null;
  city: string | null;
  country_name: string | null;
  /** INT in MySQL; typed string because it is passed through parseInt(). */
  n_bookings: string;
  /** INT in MySQL; typed string because it is passed through parseInt(). */
  h_bounce: string;
  created_at: Date | null;
}

export interface PhpAdminSyncSummary {
  triggeredBy: string;
  startedAt: string;
  watermarkFrom: string | null;
  watermarkTo: string | null;
  mysqlRowsFetched: number;
  alreadyInUnified: number;
  newlyInserted: number;
  durationMs: number;
  status: string;
  error: string | null;
}

export interface WaUnsubRow extends RowDataPacket {
  destination: string | null;
  created_at: Date;
}

export interface WaUnsubSummary {
  triggeredBy: string;
  startedAt: string;
  watermarkFrom: string | null;
  mysqlRowsFetched: number;
  flipped: number;
  durationMs: number;
  status: string;
  error: string | null;
}

export interface ChatSourceRow extends RowDataPacket {
  id: number;
  wa_id: string | null;
  wa_name: string | null;
  email: string | null;
  country: string | null;
  receiver: string | null;
  boat: string | null;
  status: string | null;
  priority: string | number | null;
  tags: string | null;
  fv: string | number | null;
  last_in: Date | null;
  last_out: Date | null;
  last_msg: Date | null;
  last_short: string | null;
  seen: number | null;
  spam: number | null;
  last_packed: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface ChatsSyncResult {
  watermark: string | null;
  inserted: number;
  unifiedMatched: number;
  promoted: number;
  elapsedMs: number;
}

/** Raw record from the Rayna billing API (getallyesterdaybookingdatedata). */
export interface BillingApiRecord {
  BillSerial?: string | number | null;
  BillNo?: string | number | null;
  BillType?: string | null;
  IsB2B?: string | number | boolean | null;
  ServiceId?: string | number | null;
  TravelDate?: string | null;
  ServiceName?: string | null;
  /** May be numeric at runtime; parseFloat() handles both. */
  SellingPrice: string;
  IsCancel?: string | number | boolean | null;
  Guest_Name?: string | null;
  Nationality?: string | null;
  Guest_Contact?: string | null;
  Guest_Email?: string | null;
  Guest_Age?: string | number | null;
  BookingDate?: string | null;
}

export interface CountryCodeInfo {
  country: string;
  nationality: string;
  region: string;
}

export interface CleanedPhone {
  cleaned: string;
  digits: string;
  countryCode: string | null;
  countryInfo: CountryCodeInfo | null;
}

export interface EnrichmentUpdates {
  phone_clean?: string;
  phone_country_code?: string | null;
  nationality?: string;
  gender?: string;
  enrichment_score?: string;
  [field: string]: string | null | undefined;
}

export interface EnrichmentLog {
  field: string;
  old: string | null;
  new: string;
  source: string;
  confidence: number;
}

export interface Enrichment {
  email: string;
  updates: EnrichmentUpdates;
  logs: EnrichmentLog[];
}

/** One GA4 row from BigQuery; BQ DATE/TIMESTAMP values arrive as { value } wrappers. */
export type Ga4BqRow = Record<string, unknown>;
