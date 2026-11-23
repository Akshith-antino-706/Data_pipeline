/**
 * Plain-English labels for the reasons a journey could not send to someone
 * (journey_events action_blocked details.reason, and journey_skip_log missing_keys).
 */
const LABELS: Record<string, string> = {
  frequency_capped: 'Daily email limit reached (3 in 24 h)',
  no_email: 'No email address',
  rec_no_products: 'No products to show',
  rec_allowlist_blocked: 'Not on the test allow-list',
  recommended_products: 'No products to show',
  localhost_base_url: 'Tracking link misconfigured',
  skipped: 'Skipped',
  blocked: 'Blocked',
};

/** "frequency_capped" → "Daily email limit reached (3 in 24 h)"; unknown reasons are tidied up. */
export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Blocked';
  const key = reason.toLowerCase();
  if (LABELS[key]) return LABELS[key];
  if (key.startsWith('daily_offer')) return 'Daily offer could not be priced';
  if (/^item_|destination_city|cta_url|user_first_name/.test(key)) return `Missing product details (${reason.replace(/_/g, ' ').toLowerCase()})`;
  return reason.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

/** "Daily email limit 3,127 · No email address 3,609" */
export function reasonSummary(byReason: Record<string, number>): string {
  return Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${reasonLabel(r)} ${n.toLocaleString()}`)
    .join(' · ');
}
