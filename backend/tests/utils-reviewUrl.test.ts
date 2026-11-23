import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

type ReviewModule = typeof import('../src/utils/reviewUrl.js');
const BASE = 'https://feedback.raynatours.com';

async function load(env?: string): Promise<ReviewModule> {
  vi.stubEnv('REVIEW_SITE_URL', env);
  vi.resetModules();
  return import('../src/utils/reviewUrl.js');
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { query.mockReset(); errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllEnvs(); errSpy.mockRestore(); });

describe('buildReviewUrl', () => {
  it.each([null, undefined, 0, ''])('falsy id %j -> bare base, no query', async (id) => {
    const m = await load();
    await expect(m.buildReviewUrl(id)).resolves.toBe(`${BASE}/`);
    expect(query).not.toHaveBeenCalled();
  });

  it('strips trailing slashes from REVIEW_SITE_URL', async () => {
    const m = await load('https://fb.test///');
    await expect(m.buildReviewUrl(null)).resolves.toBe('https://fb.test/');
  });

  it('no eligible bookings -> bare base', async () => {
    const m = await load();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(m.buildReviewUrl(5)).resolves.toBe(`${BASE}/`);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('booking query failure -> bare base, logs', async () => {
    const m = await load();
    query.mockRejectedValueOnce(new Error('down'));
    await expect(m.buildReviewUrl(5)).resolves.toBe(`${BASE}/`);
    expect(errSpy).toHaveBeenCalled();
  });

  it('builds a fully encoded URL from bookings + contact', async () => {
    const m = await load();
    query
      .mockResolvedValueOnce({ rows: [
        { bill_no: 'B/1 &2', bill_type: 'Tour', service_name: 'Desert Safari', travel_date: '2026-01-02' },
        { bill_no: 'B/1 &2', bill_type: 'Hotel', service_name: 'Hôtel; Ünïcode|x', travel_date: null },
      ] })
      .mockResolvedValueOnce({ rows: [{ name: 'José Ñ', email: 'a+b@x.com', contact_type: 'B2C' }] });
    const url = new URL(await m.buildReviewUrl('77'));
    expect(url.origin + url.pathname).toBe(`${BASE}/`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: 'B/1 &2', name: 'José Ñ', email: 'a+b@x.com', audience: 'b2c',
      items: 'Desert Safari|Tour|2026-01-02;Hôtel; Ünïcode|x|Hotel|',
    });
    expect(query.mock.calls[0][1]).toEqual(['77']);
    expect(query.mock.calls[1][1]).toEqual(['77']);
  });

  it('missing contact row or lookup failure -> blank name/email/audience', async () => {
    const m = await load();
    const booking = { rows: [{ bill_no: 'X1', bill_type: 'Visa', service_name: 'Visa', travel_date: '2025-05-05' }] };
    query.mockResolvedValueOnce(booking).mockResolvedValueOnce({ rows: [] });
    expect(await m.buildReviewUrl(1)).toBe(`${BASE}/?ref=X1&name=&email=&audience=&items=Visa%7CVisa%7C2025-05-05`);
    query.mockResolvedValueOnce(booking).mockRejectedValueOnce(new Error('x'));
    expect(await m.buildReviewUrl(1)).toBe(`${BASE}/?ref=X1&name=&email=&audience=&items=Visa%7CVisa%7C2025-05-05`);
  });

  it('query only touches the five booking tables with cancellation/date guards', async () => {
    const m = await load();
    query.mockResolvedValueOnce({ rows: [] });
    await m.buildReviewUrl(3);
    const sql = String(query.mock.calls[0][0]);
    for (const t of ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_packages', 'rayna_others']) expect(sql).toContain(`FROM ${t}`);
    expect(sql).toContain("is_cancel = '0'");
    expect(sql).toMatch(/^\s*WITH/);
  });
});
