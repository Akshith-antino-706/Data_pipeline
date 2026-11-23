// CustomSegmentService.getCustomers — the count honours the search and is cached per segment version.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));

import CustomSegmentService from '../src/services/CustomSegmentService.js';

const seg = { id: 7, name: 'VIP', conditions: [{ field: 'contact_type', operator: 'equals', value: 'B2C' }], updated_at: '2026-10-20T00:00:00Z' };

beforeEach(() => {
  m.query.mockReset();
  CustomSegmentService.clearCustomerCounts();
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM custom_segments')) return { rows: [seg] };
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 42 }] };
    return { rows: [{ id: 1 }] };
  });
});

describe('getCustomers', () => {
  it('counts with the same WHERE as the page (search included) and pages only run the page query', async () => {
    const r = await CustomSegmentService.getCustomers(7, { page: 2, limit: 25, search: 'ann' });
    expect(r).toMatchObject({ total: 42, page: 2, limit: 25, totalPages: 2 });
    const count = m.query.mock.calls.find(([sql]) => sql.includes('COUNT(*)::int AS count'));
    expect(count?.[0]).toContain('uc.name ILIKE $2');
    expect(count?.[1]).toEqual(['B2C', '%ann%']);
    const page = m.query.mock.calls.find(([sql]) => sql.includes('LIMIT $3 OFFSET $4'));
    expect(page?.[1]).toEqual(['B2C', '%ann%', 25, 25]);
    const before = m.query.mock.calls.length;
    await CustomSegmentService.getCustomers(7, { page: 3, limit: 25, search: 'ann' });
    expect(m.query.mock.calls.filter(([sql]) => sql.includes('COUNT(*)::int AS count'))).toHaveLength(1);
    expect(m.query.mock.calls.length).toBe(before + 2); // segment lookup + page
  });
  it('a different search or a newer segment version re-counts', async () => {
    await CustomSegmentService.getCustomers(7, { search: 'ann' });
    await CustomSegmentService.getCustomers(7, { search: 'bob' });
    expect(m.query.mock.calls.filter(([sql]) => sql.includes('COUNT(*)::int AS count'))).toHaveLength(2);
  });
  it('returns null for an unknown segment', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect(await CustomSegmentService.getCustomers(99)).toBeNull();
  });
});
