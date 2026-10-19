import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

type CurrencyModule = typeof import('../src/utils/currency.js');
let mod: CurrencyModule;

beforeEach(async () => {
  query.mockReset();
  vi.resetModules();
  vi.useRealTimers();
  mod = await import('../src/utils/currency.js');
});

describe('format', () => {
  it.each([
    [3526, 'INR', '₹3,526'], [138, 'SAR', 'SAR 138'], [128, 'AED', 'AED 128'], [35, 'USD', '$35'],
    [35, 'usd', '$35'], [1234567.5, 'AED', 'AED 1,234,568'], [0, 'AED', 'AED 0'], [-1500.4, 'USD', '$-1,500'],
    [10, 'EUR', 'EUR 10'], [10, null, 'AED 10'], [10, undefined, 'AED 10'], [10, '', 'AED 10'],
    ['42', 'AED', 'AED 42'], [0.5, 'AED', 'AED 1'], [null, 'AED', 'AED 0'],
  ])('format(%j, %j) -> %j', (a, c, out) => {
    expect(mod.format(a, c)).toBe(out);
  });

  it.each([NaN, Infinity, -Infinity, 'abc', undefined, {}])('non-finite %j -> empty string', (a) => {
    expect(mod.format(a, 'AED')).toBe('');
  });
});

describe('getRates', () => {
  it('loads and upper-cases currency codes, always with AED:1', async () => {
    query.mockResolvedValueOnce({ rows: [{ currency: 'inr', aed_to_currency: '22.5' }, { currency: 'USD', aed_to_currency: 0.27 }] });
    await expect(mod.getRates()).resolves.toEqual({ AED: 1, INR: 22.5, USD: 0.27 });
  });

  it('caches for an hour, then refetches', async () => {
    vi.useFakeTimers();
    query.mockResolvedValue({ rows: [{ currency: 'INR', aed_to_currency: 22 }] });
    await mod.getRates();
    await mod.getRates();
    expect(query).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await mod.getRates();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('never throws: DB failure -> AED only', async () => {
    query.mockRejectedValueOnce(new Error('down'));
    await expect(mod.getRates()).resolves.toEqual({ AED: 1 });
  });

  it('keeps last good rates on later failure', async () => {
    vi.useFakeTimers();
    query.mockResolvedValueOnce({ rows: [{ currency: 'INR', aed_to_currency: 22 }] });
    await mod.getRates();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    query.mockRejectedValueOnce(new Error('down'));
    await expect(mod.getRates()).resolves.toEqual({ AED: 1, INR: 22 });
  });
});

describe('convertFromAed', () => {
  it('returns the amount unchanged for AED without touching the DB', async () => {
    await expect(mod.convertFromAed(100)).resolves.toBe(100);
    await expect(mod.convertFromAed('100', 'aed')).resolves.toBe(100);
    await expect(mod.convertFromAed(100, null)).resolves.toBe(100);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([NaN, 'abc', undefined, Infinity, {}])('non-finite amount %j -> null', async (a) => {
    await expect(mod.convertFromAed(a, 'INR')).resolves.toBeNull();
  });

  it('converts with the rate (case-insensitive currency)', async () => {
    query.mockResolvedValueOnce({ rows: [{ currency: 'INR', aed_to_currency: 22 }] });
    await expect(mod.convertFromAed(10, 'inr')).resolves.toBe(220);
  });

  it('falls back to AED amount on missing, zero or NaN rate', async () => {
    query.mockResolvedValueOnce({ rows: [{ currency: 'XYZ', aed_to_currency: 0 }, { currency: 'BAD', aed_to_currency: 'x' }] });
    await expect(mod.convertFromAed(10, 'XYZ')).resolves.toBe(10);
    await expect(mod.convertFromAed(10, 'BAD')).resolves.toBe(10);
    await expect(mod.convertFromAed(10, 'GBP')).resolves.toBe(10);
  });

  it('handles zero and negative amounts', async () => {
    query.mockResolvedValueOnce({ rows: [{ currency: 'USD', aed_to_currency: 0.5 }] });
    await expect(mod.convertFromAed(0, 'USD')).resolves.toBe(0);
    await expect(mod.convertFromAed(-10, 'USD')).resolves.toBe(-5);
  });
});

describe('priceInCurrency', () => {
  it('converts and formats', async () => {
    query.mockResolvedValueOnce({ rows: [{ currency: 'INR', aed_to_currency: 22 }] });
    await expect(mod.priceInCurrency(100, 'INR')).resolves.toBe('₹2,200');
  });
  it('empty string for invalid amount', async () => {
    await expect(mod.priceInCurrency('nope', 'INR')).resolves.toBe('');
  });
  it('AED default', async () => {
    await expect(mod.priceInCurrency(99.6)).resolves.toBe('AED 100');
  });
});
