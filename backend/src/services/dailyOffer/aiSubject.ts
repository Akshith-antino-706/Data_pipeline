/**
 * Daily offer email — AI-written subject lead.
 *
 * Claude writes the first part of the subject once per day, from the day's theme and
 * products. The price part is never AI-written: buildSubject still appends
 * " – from %%DO_FROM%%", filled per recipient in their own currency.
 *
 * Anything that goes wrong — no API key, timeout, API error, refusal, or a lead that
 * breaks the rules below — returns the rule-based lead from the picker instead, with the
 * reason, so the email always has a subject and the journey records which one it used.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { OfferPick } from './types.js';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export interface SubjectSuggestion { lead: string; source: 'ai' | 'fallback'; reason: string | null }
export type SuggestSubjectFn = (pick: OfferPick, opts?: { log?: Logger }) => Promise<SubjectSuggestion>;

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

const SYSTEM = `You write email subject lines for Rayna Tours, a Dubai travel company.
Each day's email has one theme (visas, holiday packages, activities or cruises).
Write only the opening of the subject. The system appends " – from <lowest price>" after it, so
do not mention any price, currency, discount percentage or the word "from" at the end.
Rules: ${MIN_LEN}–${MAX_LEN} characters; specific to the products listed (name a destination or
two when it helps); warm and inviting, no clickbait, no ALL CAPS, no exclamation marks, no
"free"; at most one emoji, only if it fits naturally; no quotation marks.`;

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
  { client = null, env = process.env, log = console }: { client?: SubjectClient | null; env?: NodeJS.ProcessEnv; log?: Logger } = {},
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
            properties: { lead: { type: 'string', description: 'The subject opening, without any price' } },
            required: ['lead'],
            additionalProperties: false,
          },
        },
      },
      system: SYSTEM,
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
  let lead: unknown;
  try { lead = (JSON.parse(text ?? '') as { lead?: unknown }).lead; } catch { return fallback('unparseable'); }

  const problem = leadProblem(lead);
  if (problem) {
    log.warn(`[DailyOffer] AI subject rejected (${problem}): ${JSON.stringify(lead)}`);
    return fallback(`rejected:${problem}`);
  }
  return { lead: String(lead).trim(), source: 'ai', reason: null };
}
