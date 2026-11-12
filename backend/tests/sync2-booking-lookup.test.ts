import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import { findFor, listFor } from '../src/services/BookingLookupService.js';

const row = (o: Record<string, unknown>) => ({ booking_id: 11, product_id: 'P1', product_name: null, travel_date: '2026-10-20', destination_city: null, ...o });

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
});

describe('BookingLookupService.findFor', () => {
  it('returns null for an empty id without querying', async () => {
    expect(await findFor(null, 'on_trip')).toBeNull();
    expect(await findFor('', 'on_trip')).toBeNull();
    expect(m.query).not.toHaveBeenCalled();
  });

  it('throws on unknown context (no SQL built from it)', async () => {
    await expect(findFor(1, "on_trip'; --")).rejects.toThrow('Unknown context');
    expect(m.query).not.toHaveBeenCalled();
  });

  it('unions all 6 booking tables, excludes cancelled, binds the id', async () => {
    await findFor('u1', 'on_trip');
    const [sql, params] = m.query.mock.calls[0]!;
    for (const t of ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_others']) expect(sql).toContain(`FROM ${t}`);
    expect(sql.match(/UNION ALL/g)).toHaveLength(5);
    expect(sql).toContain("COALESCE(is_cancel, '0') <> '1'");
    expect(sql).toContain('BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE');
    expect(sql).toContain('LIMIT 1');
    expect(params).toEqual(['u1']);
  });

  it('future trips order by the earliest date, others by the latest', async () => {
    await findFor(1, 'future_trip');
    await findFor(1, 'past_trip');
    expect(m.query.mock.calls[0]![0]).toContain('ORDER BY travel_date::date ASC, id DESC');
    expect(m.query.mock.calls[1]![0]).toContain('ORDER BY travel_date::date DESC, id DESC');
    expect(m.query.mock.calls[1]![0]).toContain('< CURRENT_DATE - 7');
  });

  it('city chain: products join, then name scan, then Dubai', async () => {
    m.query.mockResolvedValueOnce({ rows: [row({ destination_city: 'Muscat', product_name: 'Bali Swing' })] });
    expect((await findFor(1, 'on_trip'))!.destinationCity).toBe('Muscat');
    m.query.mockResolvedValueOnce({ rows: [row({ product_name: 'ABU DHABI City Tour' })] });
    expect((await findFor(1, 'on_trip'))!.destinationCity).toBe('Abu Dhabi');
    m.query.mockResolvedValueOnce({ rows: [row({ product_name: 'Mystery Tour' })] });
    expect((await findFor(1, 'on_trip'))!.destinationCity).toBe('Dubai');
  });

  it('maps empty strings to null', async () => {
    m.query.mockResolvedValueOnce({ rows: [row({ product_id: '', travel_date: '' })] });
    expect(await findFor(1, 'on_trip')).toEqual({ bookingId: 11, productId: null, productName: null, travelDate: null, destinationCity: 'Dubai' });
  });
});

describe('BookingLookupService.listFor', () => {
  it('returns [] for no id and binds id + limit', async () => {
    expect(await listFor(null, 'on_trip')).toEqual([]);
    await listFor('u', 'past_trip', { limit: 3 });
    expect(m.query.mock.calls[0]![1]).toEqual(['u', 3]);
    await listFor('u', 'past_trip');
    expect(m.query.mock.calls[1]![1]).toEqual(['u', 10]);
  });

  it('rejects unknown context', async () => {
    await expect(listFor('u', 'nope')).rejects.toThrow('Unknown context: nope');
  });
});
