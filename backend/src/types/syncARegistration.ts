/** Types for services/RegistrationContactSync.ts (type-only). */

export interface RegSource {
  table: string;
  rank: number;
  tag: string;
  email: string;
  mobile: string;
  name: string;
  country: string;
  city: string;
  regDate: string;
  optOut: string;
}

export interface RegCountRow { n: number }
export interface RegTypeCountRow { type: string; n: number }
export interface RegIdRow { id: number }
export interface RegTypeChangeRow {
  id: number;
  email: string | null;
  old_type: string | null;
  contact_type: string;
  opted_out: boolean;
}

export interface RegSyncResult {
  processed: number;
  matchedByEmail: number | null;
  matchedByMobile: number | null;
  created: number | null;
  createdByType: Record<string, number>;
  updated: number;
  typeChanges: Record<string, number>;
  registrationsLinked: number;
  emailOptOuts: { newContacts: number | null; existingContacts: number };
  straySpellingsFixed: number | null;
  touchedIds: number[];
}
