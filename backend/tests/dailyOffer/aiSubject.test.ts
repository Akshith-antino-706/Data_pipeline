import { test, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { suggestSubjectLead, leadProblem, SUBJECT_MODEL } from '../../src/services/dailyOffer/aiSubject.js';
import type { SubjectClient } from '../../src/services/dailyOffer/aiSubject.js';
import { normalizeProduct } from '../../src/services/dailyOffer/feed.js';
import type { OfferPick } from '../../src/services/dailyOffer/types.js';
import { raw } from './fixtures.js';

const silent = { log() {}, warn() {}, error() {} };
const cruise = (name: string) => ({ ...normalizeProduct(raw({ type: 'cruise' })), name });
const pick: OfferPick = {
  loopDay: 2, theme: 'cruise', themeName: 'Cruises', subjectLead: 'Cruise holidays',
  groups: [{ title: 'Top cruises', subtitle: '', products: [cruise('Genting Dream Singapore Roundtrip Cruise'), cruise('Asian Horizons Cruise')] }],
  productKeys: [], count: 2, activityCursor: null, missingFixedVisas: [],
};

type Reply = Awaited<ReturnType<SubjectClient['beta']['messages']['create']>>;

/** Fake client whose beta.messages.create returns `reply` (or throws it), recording the request. */
function fake(reply: Reply | Error): SubjectClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    beta: { messages: { async create(req) { calls.push(req); if (reply instanceof Error) throw reply; return reply; } } },
  };
}
const answer = (lead: string, stop_reason = 'end_turn'): Reply => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify({ lead }) }] });

test('ai subject: a good lead is used as-is (trimmed)', async () => {
  const client = fake(answer('  Sail Singapore and Penang this season 🚢 '));
  const r = await suggestSubjectLead(pick, { client, log: silent });
  expect(r).toEqual({ lead: 'Sail Singapore and Penang this season 🚢', source: 'ai', reason: null });
  const req = client.calls[0] as { model: string; output_config: { format: { type: string } }; messages: Array<{ content: string }> };
  expect(req.model).toBe(SUBJECT_MODEL);
  expect(req.output_config.format.type).toBe('json_schema');
  expect(req.messages[0].content).toMatch(/Genting Dream Singapore Roundtrip Cruise/);
});

test('ai subject: no API key → standard lead, no call', async () => {
  const r = await suggestSubjectLead(pick, { env: {}, log: silent });
  expect(r).toEqual({ lead: 'Cruise holidays', source: 'fallback', reason: 'no_api_key' });
});

test('ai subject: timeout, API error, refusal and bad JSON all fall back', async () => {
  const timeout = new Anthropic.APIConnectionTimeoutError();
  expect((await suggestSubjectLead(pick, { client: fake(timeout), log: silent })).reason).toBe('timeout');
  const boom = fake(new Error('socket hang up'));
  expect((await suggestSubjectLead(pick, { client: boom, log: silent })).reason).toMatch(/^error:/);
  const refused = await suggestSubjectLead(pick, { client: fake(answer('x', 'refusal')), log: silent });
  expect(refused.reason).toBe('refusal');
  const junk = await suggestSubjectLead(pick, { client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), log: silent });
  expect([junk.source, junk.lead, junk.reason]).toEqual(['fallback', 'Cruise holidays', 'unparseable']);
});

test('ai subject: a lead that breaks the rules falls back with the rule named', async () => {
  const r = await suggestSubjectLead(pick, { client: fake(answer('Cruises from AED 816 this week')), log: silent });
  expect([r.source, r.reason]).toEqual(['fallback', 'rejected:mentions_price_or_token']);
});

test('lead rules', () => {
  expect(leadProblem('Sail Singapore and Penang this season')).toBe(null);
  expect(leadProblem('Cruise deals ✈️')).toBe(null);
  expect(leadProblem('Short')).toBe('too_short');
  expect(leadProblem('x'.repeat(71))).toBe('too_long');
  expect(leadProblem('Big cruise savings 🚢🌊 inside')).toBe('too_many_emojis');
  expect(leadProblem('BIG CRUISE SAVINGS NOW')).toBe('all_caps');
  expect(leadProblem('Your next cruise awaits!')).toBe('exclamation');
  expect(leadProblem('Holidays in Bali for ₹20,000')).toBe('mentions_price_or_token');
  expect(leadProblem('Free cruise upgrades this week')).toBe('mentions_price_or_token');
  expect(leadProblem('Visas for %%DO_FROM%% travellers')).toBe('mentions_price_or_token');
  expect(leadProblem('Line one\nline two of subject')).toBe('bad_characters');
  expect(leadProblem(42)).toBe('not_text');
});
