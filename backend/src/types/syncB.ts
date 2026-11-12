import type { FindAttributeOptions } from 'sequelize';

export type Row = Record<string, unknown>;

export interface SyncMetadataUpdate {
  rowsSynced?: number | null;
  status?: string | null;
  error?: string | null;
  durationMs?: number | null;
}

export interface MySQLDerivedColumn {
  sql: string;
  name: string;
}

export interface MySQLTableMapping {
  mysqlTable: string;
  pgTable: string;
  conflictKey: string;
  timestampColumn: string;
  connection?: string;
  modelName: 'Contact' | 'Ticket' | 'Department' | 'DepartmentEmail' | 'Chat';
  columns: string[];
  pgColumnMap?: Record<string, string>;
  columnAliases?: Record<string, string>;
  derivedColumns?: MySQLDerivedColumn[];
  extraPgColumns?: Record<string, unknown>;
  fullSync?: boolean;
}

export type MySQLAttributes = Extract<FindAttributeOptions, unknown[]>;

/** Raw billing record posted by the Rayna billing feed. */
export interface RaynaBillingRecord {
  BillSerial?: string | number | null;
  BillNo?: string | number | null;
  BillType?: string | null;
  IsB2B?: string | number | boolean | null;
  ServiceId?: string | number | null;
  TravelDate?: string | null;
  ServiceName?: string | null;
  SellingPrice?: string;
  IsCancel?: string | number | boolean | null;
  Guest_Name?: string | null;
  Nationality?: string | null;
  Guest_Contact?: string | null;
  Guest_Email?: string | null;
  Guest_Age?: string | number | null;
  BookingDate?: string | null;
}

export type RaynaMappedRow = Record<string, string | number>;
