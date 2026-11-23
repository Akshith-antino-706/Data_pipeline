import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  default: { query: vi.fn() },
}));

import { query, transaction } from '../src/config/database.js';
import { DataCleaningService as S } from '../src/services/DataCleaningService.js';

const res = (rows: QueryResultRow[]): QueryResult<QueryResultRow> => ({ rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] });
const mq = vi.mocked(query);
const mt = vi.mocked(transaction);
const clientQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult<QueryResultRow>>>();

beforeEach(() => {
  mq.mockReset();
  clientQuery.mockReset();
  mt.mockReset();
  mt.mockImplementation(async (fn) => fn({ query: clientQuery } as unknown as PoolClient));
});

describe('DataCleaningService.cleanPhone', () => {
  it.each([null, undefined, '', 0, false, '-', '0', '00', 'NA', 'N/A', 'na', 'n/a', 'null', 'NULL', 'None', '0000000000', '   '])(
    'returns null for junk %j', (v) => {
      expect(S.cleanPhone(v)).toBeNull();
    });

  it('returns null when fewer than 7 digits', () => {
    expect(S.cleanPhone('123456')).toBeNull();
    expect(S.cleanPhone('abc-12')).toBeNull();
    expect(S.cleanPhone({})).toBeNull();
  });

  it('accepts exactly 7 digits', () => {
    expect(S.cleanPhone('1234567')?.digits).toBe('1234567');
  });

  it('strips formatting and detects a 3-digit code before shorter ones', () => {
    const r = S.cleanPhone('+971 (50) 123-4567');
    expect(r).toEqual({
      cleaned: '+971501234567', digits: '971501234567', countryCode: '971',
      countryInfo: { country: 'United Arab Emirates', nationality: 'Emirati', region: 'AS' },
    });
  });

  it('detects 2- and 1-digit codes', () => {
    expect(S.cleanPhone('919876543210')?.countryCode).toBe('91');
    expect(S.cleanPhone('+1 555 123 4567')?.countryCode).toBe('1');
  });

  it('accepts numeric input', () => {
    expect(S.cleanPhone(447911123456)?.countryInfo?.country).toBe('United Kingdom');
  });

  it('returns null country for unknown prefixes', () => {
    const r = S.cleanPhone('8001234567');
    expect(r?.countryCode).toBeNull();
    expect(r?.countryInfo).toBeNull();
  });

  it('strips SQL-injection/unicode noise down to digits', () => {
    expect(S.cleanPhone("971501234567'; DROP TABLE x;--")?.cleaned).toBe('+971501234567');
    expect(S.cleanPhone('٩٧١٥٠١٢٣٤٥٦٧')).toBeNull(); // Arabic-Indic digits are not [0-9]
  });

  // Suspected bug: the international "00" dialling prefix is not stripped, so
  // 00971... gets no country and a bogus "+00971..." cleaned value.
  it('treats a 00 international prefix like +', () => {
    expect(S.cleanPhone('00971501234567')?.countryCode).toBe('971');
  });
});

describe('DataCleaningService.inferGender', () => {
  it.each([null, '', '   '])('returns null for %j', (v) => {
    expect(S.inferGender(v)).toBeNull();
  });
  it('uses the name lists, case-insensitively, first token only', () => {
    expect(S.inferGender('  MOHAMMED  Ali ')).toBe('male');
    expect(S.inferGender('Fatima Khan')).toBe('female');
  });
  it('falls back to ending heuristics', () => {
    expect(S.inferGender('Ritika')).toBe('female');
    expect(S.inferGender('Shruti')).toBe('female');
    expect(S.inferGender('Mike')).toBe('female'); // heuristic: -e ⇒ female (current behaviour)
    expect(S.inferGender('Sandeep')).toBe('male');
    expect(S.inferGender('Hansraj')).toBe('male');
    expect(S.inferGender('Mukesh')).toBe('male');
  });
  it('returns null when nothing matches', () => {
    expect(S.inferGender('Xyz')).toBeNull();
    expect(S.inferGender('123')).toBeNull();
    expect(S.inferGender('李')).toBeNull();
  });
});

describe('DataCleaningService.cleanEmail', () => {
  it.each([null, undefined, '', 0, 'null', 'NULL', 'N/A', 'na', '-', '0', '  ', 'no-at-sign'])('returns null for %j', (v) => {
    expect(S.cleanEmail(v)).toBeNull();
  });
  it('trims and lowercases', () => {
    expect(S.cleanEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
  it('does not validate beyond containing @', () => {
    expect(S.cleanEmail('@')).toBe('@');
    expect(S.cleanEmail("a'@x; DROP TABLE y")).toBe("a'@x; drop table y");
    expect(S.cleanEmail('ÜSER@例え.jp')).toBe('üser@例え.jp');
  });
});

describe('DataCleaningService.inferNationalityFromPhone', () => {
  it('returns nationality or null', () => {
    expect(S.inferNationalityFromPhone(null)).toBeNull();
    expect(S.inferNationalityFromPhone(S.cleanPhone('8001234567'))).toBeNull();
    expect(S.inferNationalityFromPhone(S.cleanPhone('+91 98765 43210'))).toBe('Indian');
  });
});

describe('DataCleaningService.enrichAllCustomers', () => {
  it('does nothing beyond an empty transaction for no rows', async () => {
    mq.mockResolvedValueOnce(res([]));
    expect(await S.enrichAllCustomers()).toEqual({ total: 0, enriched: 0 });
    expect(mq.mock.calls[0][0]).toMatch(/FROM customer_segments/);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('builds a parameterised UPDATE and enrichment_log inserts', async () => {
    const evilEmail = "x@y.com'; DROP TABLE customer_segments; --";
    mq.mockResolvedValueOnce(res([
      { email: evilEmail, full_name: 'Priya Shah', phone: '+91 98765 43210', mobile: null, whatsapp_id: null, country: null, nationality: null, gender: null, phone_clean: null },
      // already complete → only enrichment_score → skipped
      { email: 'done@x.com', full_name: 'Zz', phone: null, mobile: null, whatsapp_id: null, country: 'UAE', nationality: 'Emirati', gender: 'male', phone_clean: '+971' },
    ]));
    const out = await S.enrichAllCustomers();
    expect(out).toEqual({ total: 2, enriched: 1 });

    const [updSql, updParams] = clientQuery.mock.calls[0];
    expect(updSql).toBe('UPDATE customer_segments SET phone_clean = $1, phone_country_code = $2, nationality = $3, gender = $4, enrichment_score = $5 WHERE email = $6');
    expect(updSql).not.toContain('DROP');
    expect(updParams).toEqual(['+919876543210', '91', 'Indian', 'female', '0.80', evilEmail]);

    const logs = clientQuery.mock.calls.slice(1);
    expect(logs).toHaveLength(3);
    for (const [sql] of logs) expect(sql).toMatch(/INSERT INTO enrichment_log/);
    expect(logs[0][1]).toEqual([evilEmail, 'phone_clean', '+91 98765 43210', '+919876543210', 'normalization', 0.95]);
    expect(logs[1][1]).toEqual([evilEmail, 'nationality', null, 'Indian', 'country_code', 0.7]);
    expect(logs[2][1]).toEqual([evilEmail, 'gender', null, 'female', 'name_inference', 0.65]);
  });

  it('falls back to mobile then whatsapp_id for the phone', async () => {
    mq.mockResolvedValueOnce(res([
      { email: 'a@b.c', full_name: null, phone: null, mobile: null, whatsapp_id: '447911123456', country: null, nationality: 'X', gender: null, phone_clean: null },
    ]));
    await S.enrichAllCustomers();
    expect(clientQuery.mock.calls[0][1]).toEqual(['+447911123456', '44', '0.40', 'a@b.c']);
  });

  it('propagates transaction errors', async () => {
    mq.mockResolvedValueOnce(res([]));
    mt.mockRejectedValueOnce(new Error('tx failed'));
    await expect(S.enrichAllCustomers()).rejects.toThrow('tx failed');
  });
});

describe('DataCleaningService.getEnrichmentStats', () => {
  it('returns the first row', async () => {
    mq.mockResolvedValueOnce(res([{ total: '3' }]));
    expect(await S.getEnrichmentStats()).toEqual({ total: '3' });
    expect(mq.mock.calls[0][0]).toMatch(/COUNT\(\*\) AS total/);
    expect(mq.mock.calls[0][1]).toBeUndefined();
  });
  it('returns undefined if no rows', async () => {
    mq.mockResolvedValueOnce(res([]));
    expect(await S.getEnrichmentStats()).toBeUndefined();
  });
});
