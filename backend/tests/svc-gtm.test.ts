import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  welcome: vi.fn(async () => undefined),
  gtmJourney: vi.fn(async () => undefined),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/services/WelcomeEmailService.js', () => ({ default: { schedule: m.welcome } }));
vi.mock('../src/services/GtmJourneyService.js', () => ({ default: { onEvent: m.gtmJourney } }));

import GTMService from '../src/services/GTMService.js';
import type { GtmEventBody } from '../src/types/services_C.js';

interface Routes { emailLookup?: unknown[]; insertContact?: unknown[]; session?: unknown[]; product?: unknown[] }
function route(r: Routes = {}) {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM unified_contacts WHERE LOWER(TRIM(email))')) return { rows: r.emailLookup ?? [] };
    if (sql.includes('INSERT INTO unified_contacts')) return { rows: r.insertContact ?? [] };
    if (sql.includes('FROM gtm_events') && sql.includes('session_id')) return { rows: r.session ?? [] };
    if (sql.includes('FROM products')) return { rows: r.product ?? [] };
    if (sql.includes('INSERT INTO gtm_events')) return { rows: [{ event_id: 1 }] };
    return { rows: [] };
  });
}

/** Payloads arrive from the browser and are not type-checked; allow wrong-typed fields. */
const raw = (b: Record<string, unknown>): GtmEventBody => b as GtmEventBody;

const insertCall = () => {
  const c = m.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gtm_events'));
  if (!c) throw new Error('no insert');
  return c[1] ?? [];
};
const UNIFIED_IDX = 18, JOURNEY_IDX = 20, NODE_IDX = 21;

beforeEach(() => {
  m.query.mockReset();
  m.welcome.mockClear();
  m.gtmJourney.mockClear();
  route();
});

describe('GTMService static snippets', () => {
  it('container snippet embeds given id and default', () => {
    const s = GTMService.getContainerSnippet('GTM-ABC');
    expect(s.head).toContain("'GTM-ABC'");
    expect(s.body).toContain('ns.html?id=GTM-ABC');
    expect(GTMService.getContainerSnippet().head).toContain('GTM-RAYNA001');
  });
  it('containerId is interpolated without escaping (current behaviour)', () => {
    expect(GTMService.getContainerSnippet("x');alert(1)//").head).toContain("'x');alert(1)//'");
  });
  it('identity + dataLayer scripts are non-empty', () => {
    expect(GTMService.getUserIdentityScript().length).toBeGreaterThan(0);
    expect(GTMService.getDataLayerScripts()).toBeTruthy();
  });
});

describe('GTMService.recordEvent — customerId handling', () => {
  it('numeric customerId does not throw and skips email lookup', async () => {
    await expect(GTMService.recordEvent(raw({ eventName: 'view', customerId: 12345 }))).resolves.toBeTruthy();
    expect(m.query.mock.calls.some(([s]) => s.includes('LOWER(TRIM(email))'))).toBe(false);
    expect(insertCall()[1]).toBe(12345);
  });

  it('object / boolean / zero customerId do not throw', async () => {
    for (const customerId of [{ a: 1 }, true, 0, [], NaN]) {
      await expect(GTMService.recordEvent(raw({ eventName: 'x', customerId }))).resolves.toBeTruthy();
    }
  });

  it('array customerId containing an email is String()-ified and looked up', async () => {
    route({ emailLookup: [{ id: 5 }] });
    await GTMService.recordEvent(raw({ eventName: 'x', customerId: ['a@b.com'] }));
    const lookup = m.query.mock.calls.find(([s]) => s.includes('LOWER(TRIM(email))'));
    expect(lookup?.[1]).toEqual([['a@b.com']]);
  });

  it('email-like customerId resolves unified id via parameterised lookup', async () => {
    route({ emailLookup: [{ id: 42 }] });
    const evil = "x@y.com' OR '1'='1";
    await GTMService.recordEvent({ eventName: 'x', customerId: evil });
    const lookup = m.query.mock.calls.find(([s]) => s.includes('LOWER(TRIM(email))'));
    expect(lookup?.[0]).not.toContain("'1'='1");
    expect(lookup?.[1]).toEqual([evil]);
    expect(insertCall()[UNIFIED_IDX]).toBe(42);
    await vi.waitFor(() => expect(m.welcome).toHaveBeenCalled());
  });

  it('null/undefined/empty customerId → no lookup, unified id null, no hooks', async () => {
    for (const customerId of [null, undefined, '']) {
      m.query.mockClear();
      await GTMService.recordEvent({ eventName: 'x', customerId });
      expect(m.query).toHaveBeenCalledTimes(1);
      expect(insertCall()[UNIFIED_IDX]).toBeNull();
    }
    expect(m.welcome).not.toHaveBeenCalled();
  });
});

describe('GTMService.recordEvent — id resolution', () => {
  it('rid wins and skips lookups', async () => {
    await GTMService.recordEvent({ eventName: 'x', rid: '17', customerId: 'a@b.com', email: 'c@d.com' });
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(insertCall()[UNIFIED_IDX]).toBe(17);
  });

  it('non-numeric rid falls through; rid from pageUrl', async () => {
    await GTMService.recordEvent({ eventName: 'x', rid: 'abc', pageUrl: 'https://s/p?x=1&rid=88&journeyId=4&nodeId=n%201' });
    const p = insertCall();
    expect(p[UNIFIED_IDX]).toBe(88);
    expect(p[JOURNEY_IDX]).toBe(4);
    expect(p[NODE_IDX]).toBe('n 1');
  });

  it('explicit journeyId/nodeId beat the URL; bad journeyId → null', async () => {
    await GTMService.recordEvent({ eventName: 'x', journeyId: '9', nodeId: 'mine', pageUrl: '/?journeyId=4&nodeId=other' });
    expect(insertCall()[JOURNEY_IDX]).toBe(9);
    expect(insertCall()[NODE_IDX]).toBe('mine');
    m.query.mockClear();
    await GTMService.recordEvent({ eventName: 'x', journeyId: 'zz' });
    expect(insertCall()[JOURNEY_IDX]).toBeNull();
  });

  it('unknown email auto-creates a contact', async () => {
    route({ insertContact: [{ id: 501 }] });
    await GTMService.recordEvent({ eventName: 'x', email: 'new@ü.com', name: 'Zoë' });
    const ins = m.query.mock.calls.find(([s]) => s.includes('INSERT INTO unified_contacts'));
    expect(ins?.[1]).toEqual(['new@ü.com', 'Zoë', null, null, null]);
    expect(insertCall()[UNIFIED_IDX]).toBe(501);
  });

  it('email without @ is ignored', async () => {
    await GTMService.recordEvent({ eventName: 'x', email: 'not-an-email' });
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('falls back to session', async () => {
    route({ session: [{ unified_id: 33 }] });
    await GTMService.recordEvent({ eventName: 'x', sessionId: 's1' });
    expect(insertCall()[UNIFIED_IDX]).toBe(33);
  });

  it('catalog enrichment fills missing image/currency', async () => {
    route({ product: [{ image_url: 'https://img', currency: 'AED' }] });
    const body: GtmEventBody = { eventName: 'add_to_cart', ecommerceData: { items: [{ item_id: 7 }] } };
    await GTMService.recordEvent(body);
    expect(body.imageUrl).toBe('https://img');
    expect(body.currency).toBe('AED');
    const prod = m.query.mock.calls.find(([s]) => s.includes('FROM products'));
    expect(prod?.[1]).toEqual(['7']);
  });

  it('catalog lookup failure is swallowed', async () => {
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM products')) throw new Error('boom');
      return { rows: [{ event_id: 2 }] };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(GTMService.recordEvent({ eventName: 'x', itemId: 3 })).resolves.toEqual({ event_id: 2 });
    warn.mockRestore();
  });
});

describe('GTMService analytics/export SQL', () => {
  it('getEventAnalytics: placeholders and limit param', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await GTMService.getEventAnalytics({ eventName: "x'; DROP", dateTo: '2024-01-01' });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).not.toContain('DROP');
    expect(sql).toContain('LIMIT $3');
    expect(params).toEqual(["x'; DROP", '2024-01-01', 100]);
    expect(m.query.mock.calls[1][1]).toEqual(["x'; DROP", '2024-01-01']);
  });

  it('getExportData defaults', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await GTMService.getExportData();
    expect(m.query.mock.calls[0][0]).toContain('LIMIT $1');
    expect(m.query.mock.calls[0][1]).toEqual([1000]);
  });
});
