import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [], rowCount: 0 })),
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import ProductAffinityService from '../src/services/ProductAffinityService.js';

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status });
const inserts = () => m.query.mock.calls.filter(([s]) => s.includes('INSERT INTO products'));
const meta = () => m.query.mock.calls.find(([s]) => s.includes('sync_metadata'))!;

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('syncProducts', () => {
  it('dedupes by productId (or name), batches 50 rows × 75 columns, upserts on product_id', async () => {
    const products = [
      ...Array.from({ length: 51 }, (_, i) => ({ productId: i + 1, name: `P${i + 1}` })),
      { productId: 1, name: 'dupe' },
      { name: 'NoId' }, { name: 'NoId' },
    ];
    m.fetch.mockResolvedValueOnce(json({ products }));
    const r = await ProductAffinityService.syncProducts();
    expect(r.synced).toBe(52);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    expect(ins[0]![1]).toHaveLength(50 * 75);
    expect(ins[1]![1]).toHaveLength(2 * 75);
    expect(ins[0]![0]).toContain('ON CONFLICT (product_id) DO UPDATE SET name = EXCLUDED.name');
    expect(ins[0]![0]).not.toContain('product_id = EXCLUDED.product_id');
    // id-less product in batch starting at 50, index 1 → 900000 + 50 + 1
    expect(ins[1]![1]![75]).toBe(900051);
    expect(meta()[1]![1]).toBe(52);
    expect(meta()[0]).toContain("'success'");
  });

  it('coerces values: "" → null, numeric strings → numbers, bools, JSON, timestamps', async () => {
    m.fetch.mockResolvedValueOnce(json({ products: [{
      productId: '42.9', name: 'N', type: '', item_group_id: 'c', normalPrice: '175', salePrice: 'abc', cityId: '13668',
      _enriched: '1', available: 'false', options: [{ a: 1 }], cruise_nextDate: 'not a date', first_seen_date: '2026-01-02',
    }] }));
    await ProductAffinityService.syncProducts();
    const [sql, v] = inserts()[0] as [string, unknown[]];
    const cols = sql.match(/INSERT INTO products \(([^)]*)\)/)![1]!.split(',').map(c => c.trim());
    const col = (name: string): unknown => v[cols.indexOf(name)];
    expect(cols).toHaveLength(75);
    expect(v.slice(0, 10)).toEqual([42, 'N', null, 'c', 175, null, 'AED', null, null, 13668]);
    expect(col('page_title')).toBe('N');
    expect(col('enriched_flag')).toBe(true);
    expect(col('available')).toBe(false);
    expect(col('options')).toBe('[{"a":1}]');
    expect(col('cruise_next_date')).toBeNull();
    expect(col('first_seen_date')).toBe('2026-01-02T00:00:00.000Z');
  });

  it('empty feed returns early without writes', async () => {
    m.fetch.mockResolvedValueOnce(json({}));
    expect(await ProductAffinityService.syncProducts()).toEqual({ synced: 0, duration: '0.0' });
    expect(m.query).not.toHaveBeenCalled();
  });

  it('non-2xx records an error row and rethrows', async () => {
    m.fetch.mockResolvedValueOnce(json({}, 502));
    await expect(ProductAffinityService.syncProducts()).rejects.toThrow('Product API returned 502');
    expect(meta()[0]).toContain("'error'");
    expect(meta()[1]![2]).toBe('Product API returned 502');
  });

  it('a failing metadata write does not fail the sync', async () => {
    m.fetch.mockResolvedValueOnce(json({ products: [{ productId: 1, name: 'a' }] }));
    m.query.mockImplementation(async (sql: string) => { if (sql.includes('sync_metadata')) throw new Error('meta'); return { rows: [] }; });
    await expect(ProductAffinityService.syncProducts()).resolves.toMatchObject({ synced: 1 });
  });
});

describe('enrichProductDetails', () => {
  it('counts updated vs failed and binds title/description/id', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ product_id: 1, url: 'https://r/a b' }, { product_id: 2, url: 'u2' }, { product_id: 3, url: 'u3' }, { product_id: 4, url: 'u4' }] });
    m.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('a%20b')) return json({ title: ' T ', description: 'D' });
      if (url.endsWith('u2')) return json({}, 500);
      if (url.endsWith('u3')) return json({ title: '', description: '' });
      throw new Error('net');
    });
    const r = await ProductAffinityService.enrichProductDetails({ onlyMissing: true });
    expect(r).toMatchObject({ updated: 1, failed: 3 });
    expect(m.query.mock.calls[0]![0]).toContain("page_description IS NULL");
    expect(m.query.mock.calls[1]![1]).toEqual(['T', 'D', 1]);
  });
});

describe('refreshAffinity', () => {
  it('runs one upsert per event, sums rowCounts, survives a failing event, applies the weights', async () => {
    m.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (params?.[0] === 'add_to_cart') throw new Error('boom');
      if (sql.includes('FROM gtm_events')) return { rows: [], rowCount: 2 };
      if (sql.includes('FROM ga4_events')) return { rows: [], rowCount: 5 };
      return { rows: [], rowCount: 0 };
    });
    const r = await ProductAffinityService.refreshAffinity();
    expect(r.total).toBe(4 * 2 + 5);
    const events = m.query.mock.calls.filter(([s]) => s.includes('FROM gtm_events')).map(c => c[1]![0]);
    expect(events).toEqual(['view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'add_to_wishlist']);
    const score = m.query.mock.calls.find(([s]) => s.includes('affinity_score ='))![0].replace(/\s+/g, ' ');
    expect(score).toContain('(view_count * 5) + (cart_count * 25) + (checkout_count * 50) + (purchase_count * 100) + (wishlist_count * 15)');
  });
});

describe('recommendations', () => {
  const aff = (o: Record<string, unknown>) => ({ product_name: 'A', product_category: 'tours', purchase_count: 0, cart_count: 0, checkout_count: 0, sale_price: null, image_url: 'i', product_url: 'pu', product_page_url: null, ...o });

  it('no affinity → random popular products', async () => {
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ name: 'X' }] });
    const r = await ProductAffinityService.getRecommendations('u', 4);
    expect(r).toEqual({ affinity: [], recommendations: [{ name: 'X' }], type: 'popular' });
    expect(m.query.mock.calls[0]![1]).toEqual(['u', 3]);
    expect(m.query.mock.calls[1]![1]).toEqual([4]);
  });

  it('same-category picks excluding seen names, then pads the shortfall', async () => {
    m.query
      .mockResolvedValueOnce({ rows: [aff({}), aff({ product_name: 'B', product_category: 'tours' }), aff({ product_name: 'C', product_category: null })] })
      .mockResolvedValueOnce({ rows: [{ name: 'S1' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'R1' }, { name: 'R2' }] });
    const r = await ProductAffinityService.getRecommendations('u', 3);
    expect(m.query.mock.calls[1]![1]).toEqual([['tours'], ['A', 'B', 'C'], 3]);
    expect(m.query.mock.calls[2]![1]).toEqual([['A', 'B', 'C'], 2]);
    expect(r.recommendations.map(x => x.name)).toEqual(['S1', 'R1', 'R2']);
    expect(r.type).toBe('personalized');
  });

  it.each([
    [{ purchase_count: 1, cart_count: 1 }, 'You purchased this'],
    [{ cart_count: 2 }, 'Still in your cart'],
    [{ checkout_count: 1 }, 'You almost booked this'],
    [{}, 'You were viewing this'],
  ])('getTemplateProducts reason for %j', async (counts, reason) => {
    m.query.mockResolvedValueOnce({ rows: [aff({ ...counts, sale_price: 99 })] }).mockResolvedValue({ rows: [{ name: 'R', sale_price: 0, url: 'u' }] });
    const r = await ProductAffinityService.getTemplateProducts('u');
    expect(r.primaryProduct).toMatchObject({ name: 'A', price: 'AED 99', url: 'pu', reason });
    expect(r.recommendations[0]!.price).toBeNull();
  });
});
