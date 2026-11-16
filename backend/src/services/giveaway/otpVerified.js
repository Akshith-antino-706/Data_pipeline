/**
 * OTP "verified" event → store the verified phone on the contact.
 *
 * `phone.otp.<env>.verified` arrives on the OTP queue once a user confirms their code:
 *   { version: 1, id, type: 'verified', tenantId, accountId, phone: '+971…', email, verifiedAt }
 * The contact is found by email (case/space-insensitive, same as the idx_uc_email_lower_trim
 * index) and its unified_contacts.mobile is set to the phone in our stored format — digits only,
 * no '+' (e.g. 971566962801). Rows that already hold that number are left untouched, so a
 * redelivered message is a no-op. Every contact sharing the email is updated (duplicates are
 * the same person). Nothing is created when no contact matches.
 */
import db from '../../config/database.js';

export const normalizePhone = (phone) => String(phone ?? '').replace(/\D/g, '');

// E.164 allows at most 15 digits; anything under 7 cannot be a real international number.
export const isValidPhoneDigits = (digits) => /^\d{7,15}$/.test(digits);

export async function applyOtpVerified(p, { query = (text, params) => db.query(text, params) } = {}) {
  const email = String(p.email).trim().toLowerCase();
  const mobile = normalizePhone(p.phone);
  const { rows: [r] } = await query(
    `WITH m AS (
       SELECT id, mobile FROM unified_contacts WHERE lower(trim(email)) = $1
     ), u AS (
       UPDATE unified_contacts uc
          SET mobile = $2, updated_at = NOW()
         FROM m
        WHERE uc.id = m.id AND m.mobile IS DISTINCT FROM $2
       RETURNING uc.id, m.mobile AS old_mobile
     )
     SELECT (SELECT COUNT(*) FROM m)::int AS matched,
            COALESCE((SELECT json_agg(json_build_object('id', id, 'old_mobile', old_mobile)) FROM u), '[]'::json) AS updated`,
    [email, mobile]
  );
  return { email, mobile, matched: r?.matched ?? 0, updated: r?.updated ?? [] };
}
