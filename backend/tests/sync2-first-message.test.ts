import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import FirstMessageService from '../src/services/FirstMessageService.js';

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status });

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('FirstMessageService.fetchFirstMessage', () => {
  it('encodes from/to and returns msg on success', async () => {
    m.fetch.mockResolvedValueOnce(json({ status: 'success', msg: 'hi' }));
    expect(await FirstMessageService.fetchFirstMessage('+971 5&x', '97150')).toBe('hi');
    expect(m.fetch.mock.calls[0]![0]).toBe('https://chathead.io/apis/wa/first_msg/?from=%2B971%205%26x&to=97150');
  });

  it.each([
    ['non-ok', () => json({ status: 'success', msg: 'x' }, 500)],
    ['status != success', () => json({ status: 'error', msg: 'x' })],
    ['empty msg', () => json({ status: 'success', msg: '' })],
    ['bad json', () => new Response('<html>', { status: 200 })],
  ])('returns null for %s', async (_l, res) => {
    m.fetch.mockResolvedValueOnce(res());
    expect(await FirstMessageService.fetchFirstMessage('a', 'b')).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    m.fetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await FirstMessageService.fetchFirstMessage('a', 'b')).toBeNull();
  });
});

describe('FirstMessageService.processBatch / updateMessages', () => {
  it('maps every row to {id, wa_id, msg}', async () => {
    m.fetch.mockImplementation(async (url: string) => json({ status: 'success', msg: url.includes('from=w2') ? 'two' : '' }));
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, wa_id: `w${i}`, receiver: 'r' }));
    const out = await FirstMessageService.processBatch(rows);
    expect(out).toHaveLength(12);
    expect(out[2]).toEqual({ id: 2, wa_id: 'w2', msg: 'two' });
    expect(out[0]!.msg).toBeNull();
  });

  it('strips NUL bytes and lone surrogates, skips null msgs, survives a failing row', async () => {
    m.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('encoding')).mockResolvedValueOnce({ rows: [] });
    const n = await FirstMessageService.updateMessages([
      { id: 1, wa_id: 'a', msg: 'he\0llo\uD800' },
      { id: 2, wa_id: 'b', msg: null },
      { id: 3, wa_id: 'c', msg: 'bad' },
      { id: 4, wa_id: 'd', msg: 'ok' },
    ]);
    expect(n).toBe(2);
    expect(m.query.mock.calls[0]![1]).toEqual(['hello', 1]);
    expect(m.query).toHaveBeenCalledTimes(3);
  });
});

describe('FirstMessageService.syncAll', () => {
  it('processes batches until the SELECT is empty', async () => {
    vi.useFakeTimers();
    let selects = 0;
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT')) { selects++; return { rows: selects === 1 ? [{ id: 1, wa_id: 'a', receiver: 'b' }] : [] }; }
      return { rows: [] };
    });
    m.fetch.mockResolvedValue(json({ status: 'success', msg: 'm' }));
    const p = FirstMessageService.syncAll();
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ totalProcessed: 1, totalUpdated: 1 });
    expect(m.query.mock.calls[0]![1]).toEqual([500, 0]);
  });

  // Fixed: syncAll uses an id cursor, so an unfetchable chat (first_msg_text stays NULL)
  // is asked about only once per run. The mock keeps returning it for 5 batches.
  it('does not re-fetch the same unfetchable chat forever', async () => {
    vi.useFakeTimers();
    let selects = 0;
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT')) { selects++; return { rows: selects <= 5 ? [{ id: 1, wa_id: 'a', receiver: 'b' }] : [] }; }
      return { rows: [] };
    });
    m.fetch.mockResolvedValue(json({ status: 'error' }, 404));
    const p = FirstMessageService.syncAll();
    await vi.runAllTimersAsync();
    await p;
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('FirstMessageService.syncAll paging', () => {
  it('advances the id cursor across full pages', async () => {
    vi.useFakeTimers();
    let selects = 0;
    m.query.mockImplementation(async (sql: string) => {
      if (!sql.includes('SELECT')) return { rows: [] };
      selects++;
      if (selects === 1) return { rows: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, wa_id: 'a', receiver: 'b' })) };
      return { rows: [{ id: 501, wa_id: 'a', receiver: 'b' }] };
    });
    m.fetch.mockResolvedValue(json({ status: 'error' }, 404));
    const p = FirstMessageService.syncAll();
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ totalProcessed: 501, totalUpdated: 0 });
    const selectsCalls = m.query.mock.calls.filter(([s]) => s.includes('SELECT'));
    expect(selectsCalls.map(c => c[1])).toEqual([[500, 0], [500, 500]]);
  });
});
