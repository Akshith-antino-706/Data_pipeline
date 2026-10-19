import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import UTMService from '../src/services/UTMService.js';

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
});

const qs = (url: string) => new URL(url).searchParams;

describe('UTMService.generateToken', () => {
  it('returns 10 URL-safe chars and differs between calls', () => {
    const a = UTMService.generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(UTMService.generateToken()).not.toBe(a);
  });
});

describe('UTMService.buildUTM', () => {
  it('uses defaults when everything is empty', () => {
    const url = UTMService.buildUTM({});
    expect(url.startsWith('https://www.raynatours.com/activities?')).toBe(true);
    const p = qs(url);
    expect(p.get('utm_source')).toBe('AI_marketer');
    expect(p.get('utm_medium')).toBe('email');
    expect(p.get('utm_campaign')).toBe('campaign_all');
    expect(p.get('utm_content')).toBe('email_1');
    expect(p.has('journeyId')).toBe(false);
  });

  it('null channel/name/segment fall back to defaults', () => {
    const p = qs(UTMService.buildUTM({ channel: null, campaignName: null, segmentLabel: null }));
    expect(p.get('utm_medium')).toBe('email');
    expect(p.get('utm_campaign')).toBe('campaign_all');
  });

  it('sanitises campaign/segment/node (spaces, unicode, injection)', () => {
    const p = qs(UTMService.buildUTM({ campaignName: "Summer Sale' OR 1=1", segmentLabel: 'Café Lovers', nodeId: 'n 1/<x>' , journeyId: 9 }));
    expect(p.get('utm_campaign')).toBe('Summer_Sale__OR_1_1_Caf__Lovers');
    expect(p.get('utm_content')).toBe('email_1_j9_n_1__x_');
    expect(p.get('nodeId')).toBe('n 1/<x>');
    expect(p.get('journeyId')).toBe('9');
  });

  it('campaignId wins over contentNumber', () => {
    expect(qs(UTMService.buildUTM({ channel: 'whatsapp', campaignId: 42, contentNumber: 3 })).get('utm_content')).toBe('whatsapp_camp42');
    expect(qs(UTMService.buildUTM({ contentNumber: 3 })).get('utm_content')).toBe('email_3');
  });

  it('campaignId 0 / journeyId 0 treated as absent', () => {
    const p = qs(UTMService.buildUTM({ campaignId: 0, journeyId: 0 }));
    expect(p.get('utm_content')).toBe('email_1');
    expect(p.has('journeyId')).toBe(false);
  });

  it('custom baseUrl is used verbatim (base already containing ? yields a second ?)', () => {
    const url = UTMService.buildUTM({ baseUrl: 'https://x.test/p?a=1' });
    expect(url.startsWith('https://x.test/p?a=1?utm_source=')).toBe(true);
  });
});

describe('UTMService DB methods (mocked)', () => {
  it('recordClick / recordConversion parameterise ids', async () => {
    await UTMService.recordClick("1; DROP TABLE utm_tracking");
    expect(m.query.mock.calls[0][1]).toEqual(['1; DROP TABLE utm_tracking']);
    expect(m.query.mock.calls[0][0]).not.toContain('DROP');
    await UTMService.recordConversion(5);
    expect(m.query.mock.calls[1][1]).toEqual([5, 0]);
  });

  it('generateForCampaign throws when campaign missing', async () => {
    await expect(UTMService.generateForCampaign(999)).rejects.toThrow('Campaign not found');
  });

  it('generateForCampaign reuses existing utm_id when ON CONFLICT returns nothing', async () => {
    m.query
      .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Promo X', segment_label: 'vip', channel: 'email', template_id: null, template_cta_url: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ utm_id: 77 }] });
    const r = await UTMService.generateForCampaign(3, { journeyId: 2, nodeId: 'a b' });
    expect(r.utm_id).toBe(77);
    const insertParams = m.query.mock.calls[1][1];
    expect(insertParams?.[5]).toBe('Promo_X_vip');
    expect(insertParams?.[6]).toBe('email_camp3_j2_a_b');
    expect(insertParams?.[10]).toBe('a b');
  });

  it('getAnalytics builds sequential placeholders and reuses params for all 3 queries', async () => {
    await UTMService.getAnalytics({ segmentLabel: 'vip', dateTo: '2024-01-31' });
    expect(m.query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of m.query.mock.calls) {
      expect(sql).toContain('ut.segment_label = $1 AND ut.created_at <= $2');
      expect(params).toEqual(['vip', '2024-01-31']);
    }
  });

  it('getAnalytics with no filters → 1=1 and empty params', async () => {
    await UTMService.getAnalytics();
    expect(m.query.mock.calls[0][1]).toEqual([]);
  });

  it('trackClick returns null for unknown token and skips parent update', async () => {
    expect(await UTMService.trackClick('nope')).toBeNull();
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('trackClick bumps parent utm_tracking when linked', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ token: 't', utm_id: 4 }] });
    await UTMService.trackClick('t');
    expect(m.query.mock.calls[1][1]).toEqual([4]);
  });

  it('getUserLinks: filters, clicked string matching, limit/offset placement', async () => {
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}] });
    await UTMService.getUserLinks({ campaignId: 1, clicked: 'true', search: '%_\'', limit: 5, offset: 10 });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain('ul.click_count > 0');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual([1, "%%_'%", 5, 10]);
    expect(m.query.mock.calls[1][1]).toEqual([1, "%%_'%"]);
    expect(m.query.mock.calls[1][0]).not.toContain('LIMIT');
  });

  it('getUserLinks: boolean clicked (not string) is ignored', async () => {
    await UTMService.getUserLinks({ clicked: true });
    expect(m.query.mock.calls[0][0]).not.toContain('click_count >');
    expect(m.query.mock.calls[0][1]).toEqual([200, 0]);
  });
});
