/**
 * OTP "verified" event → store the verified phone (and its country) on the contact.
 *
 * `phone.otp.<env>.verified` arrives on the OTP queue once a user confirms their code:
 *   { version: 1, id, type: 'verified', tenantId, accountId, phone: '+971…', email, verifiedAt }
 * The contact is found by email (case/space-insensitive, same as the idx_uc_email_lower_trim
 * index) and its unified_contacts.mobile is set to the phone in our stored format — digits only,
 * no '+' (e.g. 971566962801). mobile_country is set from the number's dialling code, using the
 * same country names as the nightly enrichment job (+91… → 'India', +971… → 'UAE'); when the
 * number can't be parsed the existing mobile_country is kept. Rows that already hold both values
 * are left untouched, so a redelivered message is a no-op. Every contact sharing the email is
 * updated (duplicates are the same person). Nothing is created when no contact matches.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { QueryResult } from 'pg';
import db from '../../config/database.js';
import { COUNTRY_NAMES } from '../ContactEnrichmentService.js';

/** A contact whose mobile/country changed, with the values it had before. */
export interface OtpVerifiedChange { id: number; old_mobile: string | null; old_country: string | null }

export interface OtpVerifiedResult {
  email: string;
  mobile: string;
  country: string | null;
  matched: number;
  updated: OtpVerifiedChange[];
}

type QueryFn = (text: string, params: unknown[]) => Promise<QueryResult<{ matched: number; updated: OtpVerifiedChange[] }>>;

export const normalizePhone = (phone: unknown): string => String(phone ?? '').replace(/\D/g, '');

// E.164 allows at most 15 digits; anything under 7 cannot be a real international number.
export const isValidPhoneDigits = (digits: string): boolean => /^\d{7,15}$/.test(digits);

// Country name for international digits (no '+'), or null when the number isn't valid.
export function phoneCountry(digits: string): string | null {
  const parsed = parsePhoneNumberFromString('+' + digits);
  if (!parsed?.isValid() || !parsed.country) return null;
  return COUNTRY_NAMES[parsed.country] || parsed.country;
}

export async function applyOtpVerified(
  p: { email?: string; phone?: string },
  { query = (text, params) => db.query(text, params) }: { query?: QueryFn } = {},
): Promise<OtpVerifiedResult> {
  const email = String(p.email).trim().toLowerCase();
  const mobile = normalizePhone(p.phone);
  const country = phoneCountry(mobile);
  const { rows: [r] } = await query(
    `WITH m AS (
       SELECT id, mobile, mobile_country FROM unified_contacts WHERE lower(trim(email)) = $1
     ), u AS (
       UPDATE unified_contacts uc
          SET mobile = $2, mobile_country = COALESCE($3, m.mobile_country), updated_at = NOW()
         FROM m
        WHERE uc.id = m.id
          AND (m.mobile IS DISTINCT FROM $2 OR ($3::text IS NOT NULL AND m.mobile_country IS DISTINCT FROM $3))
       RETURNING uc.id, m.mobile AS old_mobile, m.mobile_country AS old_country
     )
     SELECT (SELECT COUNT(*) FROM m)::int AS matched,
            COALESCE((SELECT json_agg(json_build_object('id', id, 'old_mobile', old_mobile, 'old_country', old_country)) FROM u), '[]'::json) AS updated`,
    [email, mobile, country]
  );
  return { email, mobile, country, matched: r?.matched ?? 0, updated: r?.updated ?? [] };
}
