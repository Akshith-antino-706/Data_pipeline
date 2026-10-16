/** Types for the registration-data API sync (src/crons/registrationDataSync.ts). */

export interface RegistrationType {
  type: string;
  table: string;
  key: string;
}

/** A scalar value as returned by the registration-data API. */
export type RegValue = string | number | boolean | null | undefined;

/** One API record: field name → value. */
export type RegRecord = Record<string, RegValue>;

/** A row of affiliate_data / guestuser_data / agent_data (every column is text). */
export type RegDbRow = Record<string, string | null>;

export interface RegSyncResult {
  type: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface RegSyncError {
  type: string;
  error: string;
}
