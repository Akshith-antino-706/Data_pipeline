/**
 * Global email send ALLOW-LIST (safelist) gate.
 *
 * Controlled by the WELCOME_EMAILS env var — a comma-separated list of addresses that
 * are permitted to receive ANY email from this project: journey mail, GTM/continuous
 * journey mail, welcome mail, campaign mail, test sends — every type.
 *
 *   WELCOME_EMAILS=rocky.86agency@gmail.com, avinash@antino.com, vaibhav@raynatours.com
 *
 * Behaviour:
 *   • var present & non-empty  → ENFORCED. A recipient on the list is sent; a recipient
 *                                NOT on the list is skipped (no email is transmitted).
 *   • var absent or empty      → DISABLED. All recipients allowed (normal production),
 *                                so removing the var safely turns the safelist off.
 *
 * Matching is case-insensitive and whitespace-trimmed (the list may contain spaces and
 * mixed case). Parsed on every call so an env reload / change takes effect without a
 * code redeploy.
 */

/** The configured allow-list as a lowercased Set, or null when the gate is disabled. */
export function allowedEmailSet() {
  const raw = process.env.WELCOME_EMAILS;
  if (raw == null) return null;                       // not configured → gate disabled
  const set = new Set(
    String(raw).split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  return set.size ? set : null;                       // empty after trim → gate disabled
}

/** True when WELCOME_EMAILS is set and non-empty (i.e. the safelist is enforced). */
export function allowlistActive() {
  return allowedEmailSet() !== null;
}

/**
 * Is this recipient permitted to receive mail?
 *   - gate disabled            → true (everyone allowed)
 *   - gate enabled & on list   → true
 *   - gate enabled & off list  → false (skip the send)
 *   - empty/blank address      → false when gate enabled
 */
export function isEmailAllowed(email) {
  const set = allowedEmailSet();
  if (!set) return true;                              // gate disabled → allow all
  if (!email) return false;
  return set.has(String(email).trim().toLowerCase());
}
