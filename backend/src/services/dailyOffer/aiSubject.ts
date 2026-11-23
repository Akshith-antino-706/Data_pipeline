/**
 * Daily offer email — AI-written subject lead and email copy.
 *
 * Claude writes, once per day and audience, from the day's theme and products:
 *   lead       the first part of the subject
 *   headline   the big heading in the email — must not repeat the subject
 *   intro      a line under the headline
 *   preheader  the inbox preview text next to the subject
 * The price part is never AI-written: buildSubject still appends " – from %%DO_FROM%%"
 * and the intro is followed by "Prices from %%DO_FROM%%.", filled per recipient.
 * 'b2b' writes for travel agents booking through the portal instead of holidaymakers.
 *
 * Anything that goes wrong — no API key, timeout, API error, refusal, or a lead that
 * breaks the rules below — returns the rule-based lead from the picker instead, with the
 * reason, so the email always has a subject and the journey records which one it used.
 * A headline / intro / preheader that breaks its rules comes back null on its own (the
 * lead is still used); the caller fills the gap.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { OfferAudience, OfferPick } from './types.js';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export interface SubjectSuggestion {
  lead: string; source: 'ai' | 'fallback'; reason: string | null;
  headline?: string | null; intro?: string | null; preheader?: string | null;
}
export type SuggestSubjectFn = (pick: OfferPick, opts?: { log?: Logger; audience?: OfferAudience }) => Promise<SubjectSuggestion>;

/** The one SDK call this module makes — a fake with this shape is injected in tests. */
export interface SubjectClient {
  beta: { messages: { create(req: Record<string, unknown>): Promise<{ stop_reason: string | null; content: Array<{ type: string; text?: string }> }> } };
}

export const SUBJECT_MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = 20000;
const MIN_LEN = 15;
const MAX_LEN = 70;          // the " – from AED 1,234" suffix follows; inboxes cut around 80–90
const EMOJI = /\p{Extended_Pictographic}/gu;
// The price is added after the lead, so the lead must not carry its own (it would be
// wrong for most markets) or any template token.
const FORBIDDEN = /%|\{|\}|\b(AED|INR|SAR|USD|GBP|EUR|Rs)\b|[₹$£€]|\bfree\b|\bfrom\s*$/i;

// Headline / intro / preheader limits. The headline is the email's H1 (29px, 2 lines max).
const COPY_LIMITS = { headline: [12, 60], intro: [40, 160], preheader: [40, 110] } as const;
type CopyField = keyof typeof COPY_LIMITS;
const PRICE = /%|\{|\}|\b(AED|INR|SAR|USD|GBP|EUR|Rs)\b|[₹$£€]|\bfree\b|\d+\s?%/i;

const READERS: Record<OfferAudience, string> = {
  b2c: `The email goes to holidaymakers who book with Rayna Tours themselves. Warm and inviting.`,
  b2b: `The email goes to travel agents and tour operators who book these products for their own
clients through the Rayna B2B portal. Speak to them as trade partners: products their clients
ask for, ready to book, at B2B rates. Never address them as the traveller ("your next trip",
"your holiday"); no commission figures.`,
};

const systemFor = (audience: OfferAudience): string => `You write the daily offer email for Rayna Tours, a Dubai travel company.
Each day's email has one theme (visas, holiday packages, activities or cruises).
${READERS[audience]}

Write four pieces:
- lead: the opening of the subject line. The system appends " – from <lowest price>" after it,
  so it must not end with "from". ${MIN_LEN}–${MAX_LEN} characters; specific to the products listed
  (name a destination or two when it helps); at most one emoji, only if it fits naturally.
- headline: the big heading at the top of the email, read right after the subject. It must say
  something different from the lead: do not repeat or reword it. ${COPY_LIMITS.headline[0]}–${COPY_LIMITS.headline[1]} characters, no emoji.
- intro: one or two short sentences under the headline about what is in today's email.
  The system adds "Prices from <lowest price>." after it. ${COPY_LIMITS.intro[0]}–${COPY_LIMITS.intro[1]} characters, no emoji.
- preheader: the inbox preview text shown next to the subject; it adds to the subject, never
  repeats it. ${COPY_LIMITS.preheader[0]}–${COPY_LIMITS.preheader[1]} characters, no emoji.

Rules for all four: no price, currency, discount percentage or "free"; no clickbait, no ALL CAPS,
no exclamation marks, no quotation marks.`;

let _client: SubjectClient | null = null;
function defaultClient(): SubjectClient {
  // The request carries the server-side fallback beta fields, which this SDK version's
  // typed params don't list yet — the narrow SubjectClient view sends them as-is.
  if (!_client) _client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 }) as unknown as SubjectClient;
  return _client;
}

/** Why `lead` can't be used, or null when it is fine. */
export function leadProblem(lead: unknown): string | null {
  if (typeof lead !== 'string') return 'not_text';
  const s = lead.trim();
  if (s.length < MIN_LEN) return 'too_short';
  if (s.length > MAX_LEN) return 'too_long';
  if (/[\r\n"“”]/.test(s)) return 'bad_characters';
  if (FORBIDDEN.test(s)) return 'mentions_price_or_token';
  if ((s.match(EMOJI) || []).length > 1) return 'too_many_emojis';
  if (s.includes('!')) return 'exclamation';
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) return 'all_caps';
  return null;
}

const words = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Why a headline / intro / preheader can't be used, or null when it is fine. */
export function copyProblem(field: CopyField, text: unknown, lead: string): string | null {
  if (typeof text !== 'string') return 'not_text';
  const s = text.trim();
  const [min, max] = COPY_LIMITS[field];
  if (s.length < min) return 'too_short';
  if (s.length > max) return 'too_long';
  if (/[\r\n"“”]/.test(s)) return 'bad_characters';
  if (PRICE.test(s)) return 'mentions_price_or_token';
  if (s.match(EMOJI)) return 'emoji';
  if (s.includes('!')) return 'exclamation';
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) return 'all_caps';
  const a = words(s), b = words(lead);
  if (a === b || a.includes(b) || b.includes(a)) return 'repeats_subject';
  return null;
}

/** The day's offer as plain text for the prompt. */
function describe(pick: OfferPick): string {
  const lines = [`Theme: ${pick.themeName}`, `Current subject opening (for reference): ${pick.subjectLead}`];
  for (const g of pick.groups) {
    lines.push(`\n${g.title}${g.subtitle ? ` — ${g.subtitle}` : ''}:`);
    for (const p of g.products) lines.push(`- ${p.name}`);
  }
  return lines.join('\n');
}

/**
 * Subject lead for today's pick.
 * Returns { lead, source: 'ai' | 'fallback', reason } — never throws.
 */
export async function suggestSubjectLead(
  pick: OfferPick,
  { client = null, env = process.env, log = console, audience = 'b2c' }: { client?: SubjectClient | null; env?: NodeJS.ProcessEnv; log?: Logger; audience?: OfferAudience } = {},
): Promise<SubjectSuggestion> {
  const fallback = (reason: string): SubjectSuggestion => ({ lead: pick.subjectLead, source: 'fallback', reason });
  if (!client && !env.ANTHROPIC_API_KEY) return fallback('no_api_key');

  let response;
  try {
    response = await (client || defaultClient()).beta.messages.create({
      model: SUBJECT_MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              lead: { type: 'string', description: 'The subject opening, without any price' },
              headline: { type: 'string', description: 'The heading at the top of the email, different from the subject' },
              intro: { type: 'string', description: 'One or two sentences under the headline' },
              preheader: { type: 'string', description: 'Inbox preview text next to the subject' },
            },
            required: ['lead', 'headline', 'intro', 'preheader'],
            additionalProperties: false,
          },
        },
      },
      system: systemFor(audience),
      messages: [{ role: 'user', content: describe(pick) }],
    });
  } catch (e) {
    const reason = e instanceof Anthropic.APIConnectionTimeoutError ? 'timeout'
      : e instanceof Anthropic.APIError ? `api_error_${e.status ?? 'connection'}`
      : `error:${(e as Error).message}`;
    log.warn(`[DailyOffer] AI subject failed (${reason}) — using the standard subject`);
    return fallback(reason);
  }

  if (response.stop_reason === 'refusal') return fallback('refusal');
  if (response.stop_reason === 'max_tokens') return fallback('max_tokens');
  const text = response.content.find(b => b.type === 'text')?.text;
  let out: Record<string, unknown>;
  try { out = JSON.parse(text ?? '') as Record<string, unknown>; } catch { return fallback('unparseable'); }
  const lead = out?.lead;

  const problem = leadProblem(lead);
  if (problem) {
    log.warn(`[DailyOffer] AI subject rejected (${problem}): ${JSON.stringify(lead)}`);
    return fallback(`rejected:${problem}`);
  }
  const good = String(lead).trim();
  const copy = (field: CopyField): string | null => {
    const p = copyProblem(field, out[field], good);
    if (!p) return String(out[field]).trim();
    log.warn(`[DailyOffer] AI ${field} rejected (${p}): ${JSON.stringify(out[field])}`);
    return null;
  };
  return { lead: good, source: 'ai', reason: null, headline: copy('headline'), intro: copy('intro'), preheader: copy('preheader') };
}
