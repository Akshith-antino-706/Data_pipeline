// Turns raw provider / SMTP / API error text into a plain-language reason a non-technical
// user can act on. The raw text is still shown separately as "Technical details".
export interface FriendlyError { reason: string; action: string }

const RULES: { test: RegExp; reason: string; action: string }[] = [
  { test: /\b535\b|authentication (data|failed|unsuccessful)|invalid login|username and password not accepted|auth(entication)? error/i,
    reason: 'Email server login failed',
    action: 'The sending email account\'s username or password is wrong. Ask your admin to check the email (SMTP) settings — no emails from this sender are going out.' },
  { test: /\b(550|551|553)\b|user unknown|no such user|mailbox (unavailable|not found|does not exist)|recipient address rejected|address not found/i,
    reason: 'Email address does not exist',
    action: 'The address is wrong or closed. Correct it on the contact, or leave it.' },
  { test: /\b552\b|mailbox full|quota exceeded|over quota|insufficient storage/i,
    reason: 'Recipient\'s mailbox is full',
    action: 'Nothing to fix on our side; it may work later.' },
  { test: /\b(421|450|451|452|454)\b|try again later|temporar(y|ily)|rate limit|too many (requests|connections|messages)|throttl/i,
    reason: 'Sending was temporarily limited',
    action: 'The provider asked us to slow down. It usually works on the next attempt.' },
  { test: /\b554\b|spam|blocked|blacklist|blocklist|rejected for policy|message rejected/i,
    reason: 'Blocked by the recipient\'s email provider',
    action: 'The message was treated as spam or blocked. Check the content and the sender\'s reputation.' },
  { test: /bounce/i, reason: 'Email bounced', action: 'The recipient\'s server returned the email. Check the address.' },
  { test: /complain/i, reason: 'Marked as spam by the recipient', action: 'They will not get more emails from us.' },
  { test: /unsubscrib|opted? ?out/i, reason: 'Contact has unsubscribed', action: 'Not sent on purpose — they asked not to be contacted.' },
  { test: /timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|network/i,
    reason: 'Could not reach the sending service',
    action: 'A connection problem. It usually works on the next attempt; tell your admin if it keeps happening.' },
  { test: /invalid (phone|number|mobile|msisdn)|not a valid (phone|number)|incorrect number/i,
    reason: 'Phone number is not valid', action: 'Correct the number on the contact.' },
  { test: /not (opted|registered) (in|on) whatsapp|not a whatsapp user|whatsapp.*not (available|registered)/i,
    reason: 'Number is not on WhatsApp', action: 'Use email or SMS for this contact.' },
  { test: /template.*(not approved|rejected|paused|disabled)|(not approved|rejected).*template/i,
    reason: 'Message template is not approved', action: 'Ask your admin to get the template approved by the provider.' },
  { test: /insufficient (balance|credit|funds)|low balance|credit/i,
    reason: 'Not enough credit with the provider', action: 'Ask your admin to top up the SMS/WhatsApp account.' },
  { test: /frequency cap|cap reached|too many messages to this/i,
    reason: 'Daily message limit reached for this contact', action: 'Skipped on purpose so the contact is not over-messaged.' },
  { test: /no (email|phone|recipient)|missing (email|phone|recipient)|empty recipient/i,
    reason: 'No email or phone on the contact', action: 'Add contact details to reach them.' },
];

/** Plain-language reason for a raw error; null when there is no error text. */
export function friendlyError(raw: string | null | undefined): FriendlyError | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const rule = RULES.find(r => r.test.test(text));
  return rule ? { reason: rule.reason, action: rule.action } : { reason: 'Sending failed', action: 'See the technical details, or ask your admin.' };
}
