import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  default: { query: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  AFFINITY_VAR_KEYS, EMPTY_AFFINITY_VARS, SAMPLE_AFFINITY_VARS,
  dropEmptyAffinity, usesAffinity, getAffinityVars, getAffinityVarsMany, fillAffinityVars,
} from '../src/services/affinityVars.js';

const res = (rows: QueryResultRow[]): QueryResult<QueryResultRow> => ({ rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] });
const mq = vi.mocked(query);

beforeEach(() => {
  mq.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('affinityVars constants', () => {
  it('lists six keys', () => {
    expect(AFFINITY_VAR_KEYS).toEqual([
      'product_affinity_1', 'product_affinity_2', 'product_affinity_3',
      'service_affinity_1', 'service_affinity_2', 'service_affinity_3',
    ]);
  });
  it('EMPTY vars are all blank and frozen', () => {
    for (const k of AFFINITY_VAR_KEYS) expect(EMPTY_AFFINITY_VARS[k]).toBe('');
    expect(Object.isFrozen(EMPTY_AFFINITY_VARS)).toBe(true);
    expect(Object.isFrozen(SAMPLE_AFFINITY_VARS)).toBe(true);
  });
});

describe('dropEmptyAffinity', () => {
  it('removes empty affinity keys but keeps others', () => {
    const out = dropEmptyAffinity({ product_affinity_1: '', product_affinity_2: 'X', first_name: '', other: 0 });
    expect(out).toEqual({ product_affinity_2: 'X', first_name: '', other: 0 });
  });
  it('removes null/undefined/0 affinity values', () => {
    expect(dropEmptyAffinity({ service_affinity_1: null, service_affinity_2: undefined, service_affinity_3: 0 })).toEqual({});
  });
  it('does not mutate input and handles no arg', () => {
    const input = { product_affinity_1: '' };
    dropEmptyAffinity(input);
    expect(input).toEqual({ product_affinity_1: '' });
    expect(dropEmptyAffinity()).toEqual({});
  });
});

describe('usesAffinity', () => {
  it('detects any affinity var, case-insensitively', () => {
    expect(usesAffinity('Hi {{ product_affinity_1 }}')).toBe(true);
    expect(usesAffinity(null, undefined, 'SERVICE_AFFINITY_3')).toBe(true);
  });
  it('ignores rank 0/4, non-strings and empty input', () => {
    expect(usesAffinity('product_affinity_4 product_affinity_0')).toBe(false);
    expect(usesAffinity(123, { product_affinity_1: 'x' }, null)).toBe(false);
    expect(usesAffinity()).toBe(false);
    expect(usesAffinity('')).toBe(false);
  });
});

describe('getAffinityVars', () => {
  it.each([null, undefined, 0, ''])('returns empty vars without querying for %s', async (id) => {
    const v = await getAffinityVars(id);
    expect(v).toEqual({ ...EMPTY_AFFINITY_VARS });
    expect(Object.isFrozen(v)).toBe(false);
    expect(mq).not.toHaveBeenCalled();
  });

  it('parameterises the id and maps service labels', async () => {
    mq.mockResolvedValueOnce(res([{ product_1_name: 'Burj Khalifa', service_1: 'tours', service_2: 'visas', service_3: 'unknownline', product_2_name: null }]));
    const v = await getAffinityVars(42);
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toMatch(/FROM user_affinity_top3 WHERE unified_id = \$1/);
    expect(sql).toContain('product_1_name, service_1, product_2_name, service_2, product_3_name, service_3');
    expect(params).toEqual([42]);
    expect(v).toEqual({
      product_affinity_1: 'Burj Khalifa', service_affinity_1: 'Tours',
      product_affinity_2: '', service_affinity_2: 'Visas',
      product_affinity_3: '', service_affinity_3: 'unknownline',
    });
  });

  it('keeps an injection string out of the SQL', async () => {
    mq.mockResolvedValueOnce(res([]));
    const evil = "1; DROP TABLE user_affinity_top3; --";
    expect(await getAffinityVars(evil)).toEqual({ ...EMPTY_AFFINITY_VARS });
    expect(mq.mock.calls[0][0]).not.toContain('DROP');
    expect(mq.mock.calls[0][1]).toEqual([evil]);
  });

  it('service label lookup is case-sensitive (TOURS passes through raw)', async () => {
    mq.mockResolvedValueOnce(res([{ service_1: 'TOURS' }]));
    expect((await getAffinityVars(1)).service_affinity_1).toBe('TOURS');
  });

  it('never throws on DB failure', async () => {
    mq.mockRejectedValueOnce(new Error('boom'));
    expect(await getAffinityVars(7)).toEqual({ ...EMPTY_AFFINITY_VARS });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('getAffinityVarsMany', () => {
  it('returns an empty map without querying for null/empty/only-blank ids', async () => {
    expect((await getAffinityVarsMany(null)).size).toBe(0);
    expect((await getAffinityVarsMany(undefined)).size).toBe(0);
    expect((await getAffinityVarsMany([null, undefined, ''])).size).toBe(0);
    expect(mq).not.toHaveBeenCalled();
  });

  it('dedupes, stringifies and keeps 0 as an id', async () => {
    mq.mockResolvedValueOnce(res([{ unified_id: 1, product_1_name: 'A', service_1: 'hotels' }]));
    const map = await getAffinityVarsMany([1, '1', 0, null, 2]);
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toContain('WHERE unified_id = ANY($1::bigint[])');
    expect(params).toEqual([['1', '0', '2']]);
    expect(map.get('1')?.product_affinity_1).toBe('A');
    expect(map.get('1')?.service_affinity_1).toBe('Hotels');
    expect(map.has('2')).toBe(false);
  });

  it('returns an empty map on DB failure', async () => {
    mq.mockRejectedValueOnce(new Error('down'));
    expect((await getAffinityVarsMany([5])).size).toBe(0);
  });
});

describe('fillAffinityVars', () => {
  const vars = { product_affinity_1: 'Desert <Safari> & "Co"', service_affinity_1: 'Tours' };

  it('returns falsy input unchanged', () => {
    expect(fillAffinityVars(null, vars)).toBeNull();
    expect(fillAffinityVars(undefined, vars)).toBeUndefined();
    expect(fillAffinityVars('', vars)).toBe('');
  });

  it('escapes HTML by default', () => {
    expect(fillAffinityVars('<p>{{product_affinity_1}}</p>', vars)).toBe('<p>Desert &lt;Safari&gt; &amp; &quot;Co&quot;</p>');
  });

  it('does not escape when html:false', () => {
    expect(fillAffinityVars('{{ product_affinity_1 }}', vars, { html: false })).toBe('Desert <Safari> & "Co"');
  });

  it('matches key case-insensitively and with whitespace', () => {
    expect(fillAffinityVars('{{  SERVICE_AFFINITY_1  }}', vars)).toBe('Tours');
  });

  it('uses the inline default (single or double quotes) when the value is empty', () => {
    expect(fillAffinityVars("{{ product_affinity_2 | default: 'our best' }}", vars)).toBe('our best');
    expect(fillAffinityVars('{{product_affinity_3|default:"x y"}}', null)).toBe('x y');
  });

  it('blanks unknown-value placeholders with no default and leaves other vars alone', () => {
    expect(fillAffinityVars('[{{product_affinity_2}}] {{first_name}} {{product_affinity_4}}', vars))
      .toBe('[] {{first_name}} {{product_affinity_4}}');
  });

  it('escapes the inline default too', () => {
    expect(fillAffinityVars("{{ product_affinity_2 | default: '<b>' }}", {})).toBe('&lt;b&gt;');
  });

  it('handles unicode values', () => {
    expect(fillAffinityVars('{{product_affinity_1}}', { product_affinity_1: 'برج خليفة 🏙️' })).toBe('برج خليفة 🏙️');
  });

  // Single quotes are not escaped; only safe because values land in text nodes, not '-quoted attributes.
  it("leaves single quotes unescaped", () => {
    expect(fillAffinityVars('{{product_affinity_1}}', { product_affinity_1: "O'Neil" })).toBe("O'Neil");
  });
});
