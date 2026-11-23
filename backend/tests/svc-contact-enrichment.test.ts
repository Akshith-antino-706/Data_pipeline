import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type * as EmailValidator from '@emailcheck/email-validator-js';

type ClaudeReq = { messages: { role: string; content: string }[] };
type ClaudeRes = { content: { type: string; text: string }[] };
const { dbQuery, anthropicCreate } = vi.hoisted(() => ({
  dbQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult<QueryResultRow>>>(),
  anthropicCreate: vi.fn<(req: ClaudeReq) => Promise<ClaudeRes>>(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  default: { query: dbQuery },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));

vi.mock('@emailcheck/email-validator-js', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailValidator>();
  return { ...actual, suggestDomain: vi.fn(actual.suggestDomain) };
});

import { suggestDomain } from '@emailcheck/email-validator-js';
import ContactEnrichmentService from '../src/services/ContactEnrichmentService.js';
import type { EnrichContactRow } from '../src/types/services_A.js';

const S = ContactEnrichmentService;
const res = (rows: QueryResultRow[]): QueryResult<QueryResultRow> => ({ rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] });
const row = (p: Partial<EnrichContactRow> = {}): EnrichContactRow => ({ id: 1, email: null, mobile: null, country: null, ...p });
const mSuggest = vi.mocked(suggestDomain);
const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  dbQuery.mockReset();
  anthropicCreate.mockReset();
  mSuggest.mockClear();
  delete process.env.ANTHROPIC_API_KEY;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe('_enrichEmails — cleaning', () => {
  it('marks null/empty/whitespace/no-@ emails invalid without calling the validator', async () => {
    const out = await S._enrichEmails([row({ email: null }), row({ email: '' }), row({ email: '   ' }), row({ email: 'not-an-email' })]);
    expect(out).toEqual([
      { actualEmail: '', enrichedEmail: null, markInvalid: true, wasFixed: false },
      { actualEmail: '', enrichedEmail: null, markInvalid: true, wasFixed: false },
      { actualEmail: '   ', enrichedEmail: null, markInvalid: true, wasFixed: false },
      { actualEmail: 'not-an-email', enrichedEmail: 'not-an-email', markInvalid: true, wasFixed: false },
    ]);
    expect(mSuggest).not.toHaveBeenCalled();
  });

  it('trims and lowercases a valid email without flagging it as fixed', async () => {
    const [r] = await S._enrichEmails([row({ email: '  John.Doe@Gmail.COM ' })]);
    expect(r).toEqual({ actualEmail: '  John.Doe@Gmail.COM ', enrichedEmail: 'john.doe@gmail.com', markInvalid: false, wasFixed: false });
  });

  it('removes inner whitespace and counts that as a fix', async () => {
    const [r] = await S._enrichEmails([row({ email: 'jo hn@gmail. com' })]);
    expect(r.enrichedEmail).toBe('john@gmail.com');
    expect(r.wasFixed).toBe(true);
  });

  it('fixes a confident real-library typo (gmial.com → gmail.com)', async () => {
    const [r] = await S._enrichEmails([row({ email: 'a@gmial.com' })]);
    expect(mSuggest).toHaveBeenCalledWith({ domain: 'gmial.com' });
    expect(r).toMatchObject({ enrichedEmail: 'a@gmail.com', markInvalid: false, wasFixed: true });
  });

  it('does not apply a low-confidence suggestion (yaho.co.in stays)', async () => {
    const [r] = await S._enrichEmails([row({ email: 'a@yaho.co.in' })]);
    expect(r.enrichedEmail).toBe('a@yaho.co.in');
  });

  it('keeps unicode in the local part as-is and handles SQL-ish input as data', async () => {
    const out = await S._enrichEmails([row({ email: "x'; DROP TABLE t;--@gmail.com" })]);
    expect(out[0].actualEmail).toBe("x'; DROP TABLE t;--@gmail.com");
    expect(out[0].enrichedEmail).toBe("x';droptablet;--@gmail.com");
  });

  it('survives suggestDomain throwing', async () => {
    mSuggest.mockImplementationOnce(() => { throw new Error('lib'); });
    const [r] = await S._enrichEmails([row({ email: 'a@gmail.com' })]);
    expect(r.markInvalid).toBe(false);
  });
});

describe('_enrichEmails — domain suggestion confidence boundary (>= 0.9)', () => {
  const at = (confidence: number) => mSuggest.mockReturnValueOnce({ original: 'gmali.com', suggested: 'gmail.com', confidence });

  it('applies the suggestion at exactly 0.9', async () => {
    at(0.9);
    const [r] = await S._enrichEmails([row({ email: 'a@gmali.com' })]);
    expect(r).toMatchObject({ enrichedEmail: 'a@gmail.com', wasFixed: true, markInvalid: false });
  });

  it('applies it above 0.9 (1.0)', async () => {
    at(1);
    expect((await S._enrichEmails([row({ email: 'a@gmali.com' })]))[0].enrichedEmail).toBe('a@gmail.com');
  });

  it('does not apply it just below 0.9 (0.8999)', async () => {
    at(0.8999);
    const [r] = await S._enrichEmails([row({ email: 'a@gmali.com' })]);
    expect(r.enrichedEmail).toBe('a@gmali.com');
    expect(r.wasFixed).toBe(false);
  });

  it('does not apply at 0 or negative confidence', async () => {
    at(0);
    at(-1);
    const out = await S._enrichEmails([row({ email: 'a@gmali.com' }), row({ id: 2, email: 'b@gmali.com' })]);
    expect(out.map(o => o.enrichedEmail)).toEqual(['a@gmali.com', 'b@gmali.com']);
  });

  it('ignores a suggestion equal to the current domain', async () => {
    mSuggest.mockReturnValueOnce({ original: 'gmail.com', suggested: 'gmail.com', confidence: 1 });
    const [r] = await S._enrichEmails([row({ email: 'a@gmail.com' })]);
    expect(r.wasFixed).toBe(false);
  });

  it('skips suggestion when the domain part is empty', async () => {
    const [r] = await S._enrichEmails([row({ email: 'a@' })]);
    expect(mSuggest).not.toHaveBeenCalled();
    expect(r.markInvalid).toBe(true);
  });
});

describe('_enrichEmails — Claude fixing', () => {
  it('without an API key, leaves invalid emails marked invalid and does not call Claude', async () => {
    const [r] = await S._enrichEmails([row({ email: 'a..b@gmail.com' })]);
    expect(r).toMatchObject({ enrichedEmail: 'a..b@gmail.com', markInvalid: true, wasFixed: false });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('applies a valid Claude fix, stripping numbering and lowercasing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '1. AB@Gmail.com\n2) c@d' }] });
    const out = await S._enrichEmails([row({ email: 'a..b@gmail.com' }), row({ id: 2, email: 'c@d' })]);
    expect(out[0]).toEqual({ actualEmail: 'a..b@gmail.com', enrichedEmail: 'ab@gmail.com', markInvalid: false, wasFixed: true });
    expect(out[1].markInvalid).toBe(true); // unchanged reply → still invalid
    const prompt = anthropicCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('1. a..b@gmail.com\n2. c@d');
  });

  it('rejects an invalid Claude "fix"', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'still bad' }] });
    expect((await S._enrichEmails([row({ email: 'a..b@gmail.com' })]))[0].markInvalid).toBe(true);
  });

  it('swallows Claude API errors', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockRejectedValueOnce(new Error('429'));
    expect(await S._fixEmailsWithClaude(['x', 'y'])).toEqual([null, null]);
  });

  it('handles empty content', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockResolvedValueOnce({ content: [] });
    expect(await S._fixEmailsWithClaude(['x'])).toEqual([null]);
  });

  it('batches in groups of 50', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    const rows = Array.from({ length: 51 }, (_, i) => row({ id: i, email: `bad${i}@x` }));
    await S._enrichEmails(rows);
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
  });

  // Suspected bug: Claude's reply is matched to inputs purely by line position. If the model drops
  // or merges a line, every later contact receives another contact's "fixed" email.
  it('does not assign one contact\'s fixed email to another when Claude drops a line', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '2. bob@gmail.com' }] });
    const out = await S._enrichEmails([row({ email: 'alice@@gmail.com' }), row({ id: 2, email: 'bob@@gmail.com' })]);
    expect(out[0].enrichedEmail).not.toBe('bob@gmail.com');
  });
});

describe('_enrichMobiles', () => {
  it('handles null/empty and too-short numbers', () => {
    const out = S._enrichMobiles([row({ mobile: null }), row({ mobile: '' }), row({ mobile: '123456' })]);
    expect(out[0]).toEqual({ actualMobile: '', enrichedMobile: null, mobileCountry: null, markInvalid: false, wasFormatted: false });
    expect(out[1].markInvalid).toBe(false);
    expect(out[2]).toEqual({ actualMobile: '123456', enrichedMobile: '123456', mobileCountry: null, markInvalid: true, wasFormatted: false });
  });

  it('formats an international number and names the country', () => {
    const [r] = S._enrichMobiles([row({ mobile: '+971 50 123 4567' })]);
    expect(r).toEqual({ actualMobile: '+971 50 123 4567', enrichedMobile: '971501234567', mobileCountry: 'UAE', markInvalid: false, wasFormatted: true });
  });

  it('treats a number already in canonical form as not reformatted', () => {
    const [r] = S._enrichMobiles([row({ mobile: '971501234567' })]);
    expect(r).toMatchObject({ enrichedMobile: '971501234567', wasFormatted: false, markInvalid: false });
  });

  it('uses the country hint (case/space-insensitive) for a local number', () => {
    const [r] = S._enrichMobiles([row({ mobile: '050 123 4567', country: '  United Arab Emirates ' })]);
    expect(r).toMatchObject({ enrichedMobile: '971501234567', mobileCountry: 'UAE', markInvalid: false });
  });

  it('falls back to the ISO code when the country has no display name', () => {
    const [r] = S._enrichMobiles([row({ mobile: '+352 621 123 456' })]);
    expect(r.mobileCountry).toBe('LU');
  });

  it('marks unparseable numbers invalid and strips to digits', () => {
    const [r] = S._enrichMobiles([row({ mobile: "0000000'; DROP" })]);
    expect(r.markInvalid).toBe(true);
    expect(r.enrichedMobile).toBe('0000000');
    expect(r.mobileCountry).toBeNull();
  });

  // Suspected bug (ContactEnrichmentService.ts:327-342): parsePhoneNumber('+9876543210') returns an
  // (invalid) object instead of throwing, so the `!parsed` country-hint and India fallbacks never
  // run and a valid Indian mobile is marked invalid.
  it('formats a bare 10-digit Indian mobile with country India', () => {
    const [r] = S._enrichMobiles([row({ mobile: '9876543210', country: 'India' })]);
    expect(r).toMatchObject({ enrichedMobile: '919876543210', mobileCountry: 'India', markInvalid: false });
  });
});

describe('_enrich (DB loop)', () => {
  it('stops on an empty batch and records success with parameterised SQL', async () => {
    dbQuery.mockResolvedValueOnce(res([])).mockResolvedValueOnce(res([]));
    const out = await S.enrichNew();
    expect(out).toMatchObject({ totalProcessed: 0, emailsValidated: 0 });
    expect(dbQuery.mock.calls[0][0]).toMatch(/WHERE actual_email IS NULL[\s\S]*LIMIT \$1 OFFSET \$2/);
    expect(dbQuery.mock.calls[0][1]).toEqual([1000, 0]);
    const [metaSql, metaParams] = dbQuery.mock.calls[1];
    expect(metaSql).toMatch(/INSERT INTO sync_metadata[\s\S]*'success'/);
    expect(metaParams?.[1]).toBe(0);
  });

  it('bulk-updates a partial batch via unnest arrays', async () => {
    dbQuery
      .mockResolvedValueOnce(res([
        { id: 1, email: 'A@Gmail.com', mobile: '+971501234567', country: null },
        { id: 2, email: 'junk', mobile: '12', country: null },
      ]))
      .mockResolvedValueOnce(res([]))
      .mockResolvedValueOnce(res([]));
    const out = await S.enrichAll();
    expect(out).toMatchObject({ totalProcessed: 2, emailsValidated: 2, emailsMarkedInvalid: 1, mobilesFormatted: 1, mobilesMarkedInvalid: 1 });
    const [sql, params] = dbQuery.mock.calls[1];
    expect(sql).toMatch(/UPDATE unified_contacts AS uc SET[\s\S]*unnest\(\$1::int\[\]\)/);
    expect(params).toEqual([
      [1, 2],
      ['A@Gmail.com', 'junk'],
      ['a@gmail.com', 'junk'],
      [null, 'Yes'],
      ['+971501234567', '12'],
      ['971501234567', '12'],
      ['UAE', null],
      [null, 'Yes'],
    ]);
    expect(dbQuery).toHaveBeenCalledTimes(3); // fetch, update, metadata (partial batch → no refetch)
  });

  it('records an error row and rethrows on failure', async () => {
    dbQuery.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce(res([]));
    await expect(S.enrichNew()).rejects.toThrow('connection refused');
    const [sql, params] = dbQuery.mock.calls[1];
    expect(sql).toMatch(/'error'/);
    expect(params?.[2]).toBe("connection refused");
  });

  it('does not fail when the success metadata write fails', async () => {
    dbQuery.mockResolvedValueOnce(res([])).mockRejectedValueOnce(new Error('meta'));
    await expect(S.enrichNew()).resolves.toMatchObject({ totalProcessed: 0 });
  });
});
