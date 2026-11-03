import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { suggestSubjectLead, leadProblem, SUBJECT_MODEL } from '../../src/services/dailyOffer/aiSubject.js';

const silent = { log() {}, warn() {}, error() {} };
const pick = {
  themeName: 'Cruises',
  subjectLead: 'Cruise holidays',
  groups: [{ title: 'Top cruises', subtitle: '', products: [{ name: 'Genting Dream Singapore Roundtrip Cruise' }, { name: 'Asian Horizons Cruise' }] }],
};

/** Fake client whose beta.messages.create returns `reply` (or throws it), recording the request. */
function fake(reply) {
  const calls = [];
  return {
    calls,
    beta: { messages: { async create(req) { calls.push(req); if (reply instanceof Error) throw reply; return reply; } } },
  };
}
const answer = (lead, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify({ lead }) }] });

test('ai subject: a good lead is used as-is (trimmed)', async () => {
  const client = fake(answer('  Sail Singapore and Penang this season 🚢 '));
  const r = await suggestSubjectLead(pick, { client, log: silent });
  assert.deepEqual(r, { lead: 'Sail Singapore and Penang this season 🚢', source: 'ai', reason: null });
  const req = client.calls[0];
  assert.equal(req.model, SUBJECT_MODEL);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.match(req.messages[0].content, /Genting Dream Singapore Roundtrip Cruise/);
});

test('ai subject: no API key → standard lead, no call', async () => {
  const r = await suggestSubjectLead(pick, { env: {}, log: silent });
  assert.deepEqual(r, { lead: 'Cruise holidays', source: 'fallback', reason: 'no_api_key' });
});

test('ai subject: timeout, API error, refusal and bad JSON all fall back', async () => {
  const timeout = new Anthropic.APIConnectionTimeoutError();
  assert.equal((await suggestSubjectLead(pick, { client: fake(timeout), log: silent })).reason, 'timeout');
  const boom = fake(new Error('socket hang up'));
  assert.match((await suggestSubjectLead(pick, { client: boom, log: silent })).reason, /^error:/);
  const refused = await suggestSubjectLead(pick, { client: fake(answer('x', 'refusal')), log: silent });
  assert.equal(refused.reason, 'refusal');
  const junk = await suggestSubjectLead(pick, { client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), log: silent });
  assert.deepEqual([junk.source, junk.lead, junk.reason], ['fallback', 'Cruise holidays', 'unparseable']);
});

test('ai subject: a lead that breaks the rules falls back with the rule named', async () => {
  const r = await suggestSubjectLead(pick, { client: fake(answer('Cruises from AED 816 this week')), log: silent });
  assert.deepEqual([r.source, r.reason], ['fallback', 'rejected:mentions_price_or_token']);
});

test('lead rules', () => {
  assert.equal(leadProblem('Sail Singapore and Penang this season'), null);
  assert.equal(leadProblem('Cruise deals ✈️'), null);
  assert.equal(leadProblem('Short'), 'too_short');
  assert.equal(leadProblem('x'.repeat(71)), 'too_long');
  assert.equal(leadProblem('Big cruise savings 🚢🌊 inside'), 'too_many_emojis');
  assert.equal(leadProblem('BIG CRUISE SAVINGS NOW'), 'all_caps');
  assert.equal(leadProblem('Your next cruise awaits!'), 'exclamation');
  assert.equal(leadProblem('Holidays in Bali for ₹20,000'), 'mentions_price_or_token');
  assert.equal(leadProblem('Free cruise upgrades this week'), 'mentions_price_or_token');
  assert.equal(leadProblem('Visas for %%DO_FROM%% travellers'), 'mentions_price_or_token');
  assert.equal(leadProblem('Line one\nline two of subject'), 'bad_characters');
  assert.equal(leadProblem(42), 'not_text');
});
