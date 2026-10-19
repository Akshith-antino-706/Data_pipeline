import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { query, default: { query }, transaction: vi.fn() };
});
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import CustomSegmentService from '../src/services/CustomSegmentService.js';
import type { SegmentCondition } from '../src/types/services_B_segments.js';

const where = (conds: SegmentCondition[]) => CustomSegmentService.buildWhereClause(conds);
const one = (cond: SegmentCondition) => where([cond]);

describe('CustomSegmentService.buildWhereClause — field operators', () => {
  it('empty conditions → no clauses, idx 1', () => {
    const r = where([]);
    expect(r.clauseItems).toEqual([]);
    expect(r.params).toEqual([]);
    expect(r.nextIdx).toBe(1);
    expect(r.needsRevenueJoin || r.needsTravelDate || r.needsBookingDate).toBe(false);
  });

  it('unknown field produces no clause', () => {
    expect(one({ field: 'drop_table', value: 'x' }).clauseItems).toHaveLength(0);
  });

  it('email lower-cases and handles arrays + unicode', () => {
    const r = one({ field: 'email', value: ['A@B.COM', 'ÜSER@X.de'] });
    expect(r.clauseItems[0].clause).toBe('LOWER(uc.email) IN ($1,$2)');
    expect(r.params).toEqual(['a@b.com', 'üser@x.de']);
  });

  it('email undefined becomes the string "undefined" (current behaviour)', () => {
    expect(one({ field: 'email' }).params).toEqual(['undefined']);
  });

  it.each(['booking_status', 'product_tier', 'geography'])('%s builds IN list with raw params', (field) => {
    const r = one({ field, value: ['A', 'B', 'C'] });
    expect(r.clauseItems[0].clause).toBe(`uc.${field} IN ($1,$2,$3)`);
    expect(r.params).toEqual(['A', 'B', 'C']);
  });

  it('contact_type uses equality', () => {
    const r = one({ field: 'contact_type', value: 'B2B' });
    expect(r.clauseItems[0].clause).toBe('uc.contact_type = $1');
  });

  it('country scalar vs array, upper-cased', () => {
    expect(one({ field: 'country', value: 'ae' }).clauseItems[0].clause).toBe('UPPER(TRIM(uc.country)) = $1');
    const r = one({ field: 'country', value: ['in', 'ae'] });
    expect(r.clauseItems[0].clause).toBe('UPPER(TRIM(uc.country)) IN ($1,$2)');
    expect(r.params).toEqual(['IN', 'AE']);
  });

  it('mobile_country upper-cases free text', () => {
    expect(one({ field: 'mobile_country', value: 'India' }).params).toEqual(['INDIA']);
  });

  it('is_indian coerces only true / "yes"', () => {
    expect(one({ field: 'is_indian', value: true }).params).toEqual([true]);
    expect(one({ field: 'is_indian', value: 'yes' }).params).toEqual([true]);
    expect(one({ field: 'is_indian', value: 'YES' }).params).toEqual([false]);
    expect(one({ field: 'is_indian', value: 'no' }).params).toEqual([false]);
  });

  it('wa_status / email_status produce static SQL without params', () => {
    const a = one({ field: 'wa_status', value: 'unsubscribed' });
    expect(a.clauseItems[0].clause).toBe(`LOWER(uc.wa_unsubscribe) = 'yes'`);
    expect(a.params).toEqual([]);
    expect(one({ field: 'email_status', value: "'; DROP TABLE x; --" }).clauseItems[0].clause)
      .toContain('uc.email_unsubscribe IS NULL');
  });

  it('wa_last_msg with both, one, or neither bound', () => {
    expect(one({ field: 'wa_last_msg', value: ['2024-01-01', '2024-02-01'] }).clauseItems[0].clause)
      .toContain('c.last_msg_at >= $1::date AND c.last_msg_at < ($2::date + 1)');
    const none = one({ field: 'wa_last_msg' });
    expect(none.clauseItems[0].clause).toBe('EXISTS (SELECT 1 FROM chats c WHERE c.unified_id = uc.id)');
    expect(none.params).toEqual([]);
  });

  it('travel_date / booking_date set join flags only when bound present', () => {
    const t = one({ field: 'travel_date', value: ['2024-01-01', ''] });
    expect(t.needsTravelDate).toBe(true);
    expect(t.params).toEqual(['2024-01-01']);
    const b = one({ field: 'booking_date', value: ['', ''] });
    expect(b.needsBookingDate).toBe(false);
    expect(b.clauseItems).toHaveLength(0);
  });

  it('travel_date_within: direction operators and numeric injection safety', () => {
    const after = one({ field: 'travel_date_within', value: '7', operator: 'after' }).clauseItems[0].clause;
    expect(after).toContain('BETWEEN CURRENT_DATE AND (CURRENT_DATE + 7)');
    const before = one({ field: 'travel_date_within', value: 7, operator: 'before' }).clauseItems[0].clause;
    expect(before).toContain('BETWEEN (CURRENT_DATE - 7) AND CURRENT_DATE');
    const evil = one({ field: 'travel_date_within', value: '3; DROP TABLE x' }).clauseItems[0].clause;
    expect(evil).not.toContain('DROP');
    expect(evil).toContain('(CURRENT_DATE - 3)');
    expect(one({ field: 'travel_date_within', value: 'abc' }).clauseItems).toHaveLength(0);
  });

  it('booking_date_within accepts negative / zero numbers', () => {
    expect(one({ field: 'booking_date_within', value: '0' }).clauseItems[0].clause).toContain('(CURRENT_DATE - 0)');
    expect(one({ field: 'booking_date_within', value: '-5' }).clauseItems[0].clause).toContain('(CURRENT_DATE - -5)');
  });

  it('last_booking_age presets and explicit pairs', () => {
    const p = one({ field: 'last_booking_age', value: '90_180' });
    expect(p.params).toEqual([90, 180]);
    expect(p.needsBookingDate).toBe(true);
    expect(one({ field: 'last_booking_age', value: 'recent_90' }).params).toEqual([90]);
    expect(one({ field: 'last_booking_age', value: [30, ''] }).params).toEqual([30]);
    expect(one({ field: 'last_booking_age', value: 'bogus' }).clauseItems).toHaveLength(0);
  });

  it('revenue between/gte/lte and empty/missing operator', () => {
    const r = one({ field: 'revenue', operator: 'between', value: ['100', '500'] });
    expect(r.params).toEqual([100, 500]);
    expect(r.needsRevenueJoin).toBe(true);
    expect(one({ field: 'revenue', operator: 'gte', value: 0 }).params).toEqual([0]);
    expect(one({ field: 'revenue', operator: 'lte', value: '' }).clauseItems).toHaveLength(0);
    expect(one({ field: 'revenue', value: 10 }).clauseItems).toHaveLength(0);
  });

  it('revenue with non-numeric value pushes NaN (current behaviour)', () => {
    expect(one({ field: 'revenue', operator: 'gte', value: 'abc' }).params[0]).toBeNaN();
  });

  it('top_service / top_product: top1 vs top3, empty filtered', () => {
    const s = one({ field: 'top_service', operator: 'top1', value: ['tours'] }).clauseItems[0].clause;
    expect(s).toContain('a.service_1 IN ($1)');
    expect(s).not.toContain('service_2');
    const p = one({ field: 'top_product', value: ['k1', '', null] });
    expect(p.params).toEqual(['k1']);
    expect(p.clauseItems[0].clause).toContain('a.product_3_key IN ($1)');
    expect(one({ field: 'top_service', value: [] }).clauseItems).toHaveLength(0);
  });
});

describe('CustomSegmentService.buildWhereClause — gtm / giveaway', () => {
  it('gtm with no count + event → EXISTS', () => {
    const r = one({ type: 'gtm', gtmEvent: 'purchase' });
    expect(r.clauseItems[0].clause).toContain('EXISTS (SELECT 1 FROM gtm_events');
    expect(r.params).toEqual(['purchase']);
  });

  it('gtm with nothing → no clause', () => {
    expect(one({ type: 'gtm' }).clauseItems).toHaveLength(0);
  });

  it('gtm count gte with window days', () => {
    const r = one({ type: 'gtm', gtmEvent: 'view', countValue: '3', windowDays: '7' });
    expect(r.params).toEqual(['view', 7, 3]);
    expect(r.clauseItems[0].clause).toMatch(/>= \$3$/);
  });

  it('gtm negative/zero windowDays ignored', () => {
    expect(one({ type: 'gtm', countValue: 1, windowDays: '-3' }).params).toEqual([1]);
  });

  it('gtm between with both bounds and lte', () => {
    const r = one({ type: 'gtm', countOp: 'between', countValue: ['1', '5'] });
    expect(r.clauseItems[0].clause).toMatch(/^\(.* >= \$1 AND .* <= \$2\)$/s);
    expect(one({ type: 'gtm', countOp: 'lte', countValue: '2' }).clauseItems[0].clause).toMatch(/<= \$1$/);
  });

  it('giveaway with type/name and no count → EXISTS; nothing → none', () => {
    const r = one({ type: 'giveaway', giveawayType: 'winner', giveawayName: 'Ramadan' });
    expect(r.params).toEqual(['winner', 'Ramadan']);
    expect(r.clauseItems[0].clause).toContain('EXISTS (SELECT 1 FROM giveaway_events');
    expect(one({ type: 'giveaway' }).clauseItems).toHaveLength(0);
  });

  it('giveaway windowDays only (no type/name/count) leaves dangling param (current behaviour)', () => {
    const r = one({ type: 'giveaway', windowDays: 5 });
    expect(r.clauseItems).toHaveLength(0);
    expect(r.params).toEqual([5]);
  });
});

describe('CustomSegmentService.buildWhereClause — exclude & joinOp', () => {
  it('wraps excluded clauses in NOT()', () => {
    expect(one({ field: 'contact_type', value: 'B2C', exclude: true }).clauseItems[0].clause).toBe('NOT (uc.contact_type = $1)');
  });

  it.each([['or', 'OR'], ['Or', 'OR'], ['and', 'AND'], ['', 'AND'], ['XOR', 'AND'], ['ОR', 'AND']])('joinOp %j → %s', (input, out) => {
    expect(one({ field: 'contact_type', value: 'x', joinOp: input }).clauseItems[0].joinOp).toBe(out);
  });

  it('param indexes stay sequential across conditions', () => {
    const r = where([
      { field: 'country', value: ['a', 'b'] },
      { field: 'name', value: 'z' },
      { type: 'gtm', gtmEvent: 'e' },
    ]);
    expect(r.nextIdx).toBe(5);
    expect(r.params).toHaveLength(4);
  });
});

describe('CustomSegmentService.buildSegmentSQL', () => {
  it('no conditions → no WHERE, no joins', () => {
    const { sql, params } = CustomSegmentService.buildSegmentSQL([]);
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('LATERAL');
    expect(params).toEqual([]);
  });

  it('adds revenue join only when needed', () => {
    const { sql } = CustomSegmentService.buildSegmentSQL([{ field: 'revenue', operator: 'gte', value: 1 }]);
    expect(sql).toContain('rev_agg ON true');
    expect(sql).not.toContain('booking_agg ON true');
  });

  it('adds date join with booking-only columns', () => {
    const { sql } = CustomSegmentService.buildSegmentSQL([{ field: 'booking_date', value: ['2024-01-01'] }]);
    expect(sql).toContain('booking_agg ON true');
    expect(sql).toContain('max_booking_date');
    expect(sql).not.toContain('max_travel_date');
  });

  it('injection in values never reaches SQL text', () => {
    const evil = "'); DELETE FROM unified_contacts; --";
    const { sql, params } = CustomSegmentService.buildSegmentSQL([
      { field: 'country', value: evil }, { field: 'geography', value: [evil] },
      { type: 'gtm', gtmEvent: evil }, { field: 'top_service', value: [evil] },
      { field: 'travel_date', value: [evil, evil] },
    ]);
    expect(sql).not.toContain('DELETE');
    expect(params.length).toBeGreaterThan(0);
  });

  it('uses supplied select/orderBy/limitOffset', () => {
    const { sql } = CustomSegmentService.buildSegmentSQL([], { select: 'uc.id', orderBy: 'ORDER BY uc.id', limitOffset: 'LIMIT 5' });
    expect(sql).toMatch(/SELECT uc\.id[\s\S]*ORDER BY uc\.id[\s\S]*LIMIT 5/);
  });
});
