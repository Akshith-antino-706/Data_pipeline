import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogProduct } from '../src/types/productsAffinityCatalog.js';

const m = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn() }, query: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

type PS = typeof import('../src/services/ProductService.js').default;
const load = async (): Promise<PS> => {
  vi.resetModules();
  return (await import('../src/services/ProductService.js')).default;
};

const p = (productId: number, item_group_id: string, salePrice: number, normalPrice = salePrice, name = `Tour ${productId}`): CatalogProduct =>
  ({ productId, name, item_group_id, salePrice, normalPrice, url: `https://x/${productId}`, image: 'img' });
const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200 });

beforeEach(() => {
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProductService.getAll + cache', () => {
  it('fetches both cities with encoded params, merges and caches for 30 min', async () => {
    const S = await load();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    m.fetch.mockResolvedValueOnce(json({ success: true, products: [p(1, 'a', 10)] }))
      .mockResolvedValueOnce(json({ success: true, products: [p(2, 'b', 20)] }));
    expect((await S.getAll()).map(x => x.productId)).toEqual([1, 2]);
    expect(m.fetch.mock.calls[1]![0]).toContain('cityId=13236&cityName=Abu%20Dhabi&countryName=United%20Arab%20Emirates');
    now += 29 * 60_000;
    await S.getAll();
    expect(m.fetch).toHaveBeenCalledTimes(2);
    now += 2 * 60_000;
    m.fetch.mockResolvedValue(json({ success: true, products: [] }));
    expect(await S.getAll()).toEqual([]);
    expect(m.fetch).toHaveBeenCalledTimes(4);
  });

  it('one failing city does not drop the other; success:false is ignored', async () => {
    const S = await load();
    m.fetch.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(json({ success: true, products: [p(2, 'b', 20)] }));
    expect((await S.getAll()).map(x => x.productId)).toEqual([2]);
    const S2 = await load();
    m.fetch.mockResolvedValue(json({ success: false, products: [p(9, 'x', 1)] }));
    expect(await S2.getAll()).toEqual([]);
  });

  // Fixed: when every upstream call fails the empty result is not cached
  // (src/services/ProductService.ts getAll), so the next call retries.
  it('does not cache an empty catalog after a total fetch failure', async () => {
    const S = await load();
    m.fetch.mockRejectedValue(new Error('down'));
    await S.getAll();
    m.fetch.mockReset();
    m.fetch.mockImplementation(async () => json({ success: true, products: [p(1, 'a', 1)] }));
    expect(await S.getAll()).toHaveLength(2);
  });
});

describe('ProductService filtering / grouping', () => {
  const list = [p(1, 'theme-parks', 300, 400, 'Ferrari World'), p(2, 'city-tours', 100), p(3, 'theme-parks', 50, 50, 'IMG Worlds'), p(4, 'dhow-cruise', 80)];

  it('_filter by category, price range (string inputs) and case-insensitive search', async () => {
    const S = await load();
    expect(S._filter(list, { category: 'theme-parks' }).map(x => x.productId)).toEqual([1, 3]);
    expect(S._filter(list, { minPrice: '80', maxPrice: 100 }).map(x => x.productId)).toEqual([2, 4]);
    expect(S._filter(list, { search: 'WORLD' }).map(x => x.productId)).toEqual([1, 3]);
    expect(S._filter(list)).not.toBe(list);
  });

  it('getCategories counts and tracks min/max, sorted by count', async () => {
    const S = await load();
    m.fetch.mockResolvedValueOnce(json({ success: true, products: list })).mockResolvedValueOnce(json({}));
    expect(await S.getCategories()).toEqual([
      { category: 'theme-parks', count: 2, minPrice: 50, maxPrice: 300 },
      { category: 'city-tours', count: 1, minPrice: 100, maxPrice: 100 },
      { category: 'dhow-cruise', count: 1, minPrice: 80, maxPrice: 80 },
    ]);
    expect((await S.getById('3'))!.name).toBe('IMG Worlds');
    expect(await S.getById(99)).toBeNull();
  });

  it('getForSegment: preferred category +100, discount +50, random jitter < 20', async () => {
    const S = await load();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    m.fetch.mockResolvedValueOnce(json({ success: true, products: list })).mockResolvedValueOnce(json({}));
    const fam = await S.getForSegment('Family Travellers', 4);
    expect(fam.map(x => [x.productId, x.score])).toEqual([[1, 150], [3, 100], [2, 0], [4, 0]]);
    const lux = await S.getForSegment('VIP spender', 1);
    expect(lux[0]!.productId).toBe(4);
    const def = await S.getForSegment(null, 2);
    expect(def.map(x => x.score)).toEqual([150, 100]);
  });
});

describe('ProductService renderers', () => {
  it('email HTML shows discount %, strikethrough, coupon and CTA', async () => {
    const S = await load();
    const html = S.generateProductEmailHTML({ products: [p(1, 'water-parks', 75, 100)], heading: 'H', ctaText: 'Go', ctaUrl: 'https://c', couponCode: 'SAVE10' });
    expect(html).toContain('25% OFF');
    expect(html).toContain('line-through');
    expect(html).toContain('SAVE10');
    expect(html).toContain('water parks');
    expect(html).toContain('href="https://c"');
    const plain = S.generateProductEmailHTML({ products: [p(2, 'x', 10)], heading: 'H' });
    expect(plain).not.toContain('OFF');
    expect(plain).not.toContain('Exclusive Offer');
  });

  it('email HTML escapes product fields', async () => {
    const S = await load();
    const evil = { ...p(1, 'a<b', 10, 10, '<script>x</script>'), url: 'https://x/?a=1&b="2"', image: '" onerror="y' };
    const html = S.generateProductEmailHTML({ products: [evil], heading: 'H' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain('src="&quot; onerror=&quot;y"');
    expect(html).toContain('a&lt;b');
  });

  it('WhatsApp message numbers products and adds coupon line', async () => {
    const S = await load();
    const msg = S.generateProductWAMessage({ products: [p(1, 'a', 50, 200, 'A'), p(2, 'b', 10, 10, 'B')], intro: 'Hi', couponCode: 'C1' });
    expect(msg).toBe('Hi\n\n1. *A*\n   AED 50 (75% OFF!)\n   https://x/1\n\n2. *B*\n   AED 10\n   https://x/2\n\n🎫 Use code *C1* for extra discount!\n\n👉 Reply with a number to learn more!');
  });
});
