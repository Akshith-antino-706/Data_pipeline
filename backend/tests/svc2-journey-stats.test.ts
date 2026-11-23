import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  release: vi.fn(),
}));
vi.mock('../src/config/database.js', () => {
  const client = { query: m.clientQuery, release: m.release };
  return { default: { query: m.query, connect: async () => client }, query: m.query, transaction: vi.fn() };
});

import { refreshJourney, refreshAllJourneys, computeNodesForDate } from '../src/services/JourneyStatsService.js';

interface Script {
  jf?: Record<string, unknown> | null;
  base?: unknown[]; open?: unknown[]; click?: unknown[]; landed?: unknown[]; ses?: unknown[];
  gtm?: unknown[]; unsub?: unknown[]; dist?: unknown[]; es?: unknown[];
  lifeJe?: Record<string, number>; lifeGe?: Record<string, number>;
}
function script(s: Script) {
  m.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM journey_flows WHERE journey_id')) return { rows: s.jf ? [s.jf] : [] };
    if (sql.includes('FROM journey_entries WHERE journey_id = $1') && sql.includes('AS booked')) return { rows: [s.lifeJe ?? { entries: 0, booked: 0, exited_booked: 0, exited_unsub: 0 }] };
    if (sql.includes('FROM gtm_journey_entries')) return { rows: [s.lifeGe ?? { entries: 0, booked: 0, exited_booked: 0, exited_unsub: 0 }] };
    if (sql.includes('AS sends_today') || (sql.includes('AS entries') && sql.includes('email_send_log'))) return { rows: s.base ?? [] };
    if (sql.includes('AS human_opened')) return { rows: s.open ?? [] };
    if (sql.includes('AS human_clicked')) return { rows: s.click ?? [] };
    if (sql.includes('AS landed')) return { rows: s.landed ?? [] };
    if (sql.includes('ses_events')) return { rows: s.ses ?? [] };
    if (sql.includes('AS gtm_events')) return { rows: s.gtm ?? [] };
    if (sql.includes('unsubscribe_log')) return { rows: s.unsub ?? [] };
    if (sql.includes('AS dist_snapshot')) return { rows: s.dist ?? [] };
    if (sql.includes('pre_existing_unsub')) return { rows: s.es ?? [] };
    return { rows: [] };
  });
}
const inserts = () => m.clientQuery.mock.calls.filter(([s]) => s.includes('INSERT INTO journey_node_stats')).map(([, p]) => p ?? []);
const byNode = (id: string) => inserts().find(p => p[1] === id) ?? [];
// param index helpers (0-based)
const I = { label: 4, type: 5, channel: 6, target: 7, entries: 8, booked: 9, sent: 12, opened: 16, failed: 23, bot: 24, distActive: 26, distWaiting: 27, final: 31, entryStats: 32 };

beforeEach(() => {
  m.query.mockReset(); m.clientQuery.mockReset(); m.release.mockReset();
  m.clientQuery.mockResolvedValue({ rows: [] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  delete process.env.BOT_ENGAGEMENT_WINDOW_SEC;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('refreshJourney', () => {
  it('missing journey is skipped with no writes', async () => {
    script({ jf: null });
    expect(await refreshJourney('1')).toMatchObject({ nodes: 0, skipped: 'no_journey' });
    expect(m.clientQuery).not.toHaveBeenCalled();
  });
  it('empty journey writes only a zeroed rollup row (no NaN)', async () => {
    script({ jf: { journey_id: 1, name: 'J', status: 'active', journey_type: 'normal', nodes: null } });
    const r = await refreshJourney('1');
    expect(r.nodes).toBe(0);
    const rows = inserts();
    expect(rows).toHaveLength(1);
    const roll = rows[0];
    expect(roll[1]).toBe('__ALL__');
    expect(roll[I.label]).toBe('All nodes');
    expect(roll[I.type]).toBe('summary');
    for (const v of roll) if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    expect(roll[I.final]).toBe(false);
    expect(m.clientQuery.mock.calls[0][0]).toBe('BEGIN');
    expect(m.clientQuery.mock.calls[1]).toEqual(['DELETE FROM journey_node_stats WHERE journey_id = $1', ['1']]);
    expect(m.clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(m.release).toHaveBeenCalledTimes(1);
  });
  it('merges per-node rows, coerces strings and garbage to numbers, sums rollup', async () => {
    script({
      jf: { journey_id: 1, name: 'J', status: 'active', journey_type: 'normal', nodes: [{ id: 'n1', type: 'action', data: { label: 'Day 1', channel: 'email' } }, { id: 'n2', type: 'wait', data: {} }] },
      base: [{ node_id: 'n1', entries: '10', sent: '8', failed: '2', sends_today: '1' }, { node_id: 'n2', entries: 'abc', sent: null, failed: undefined, sends_today: '' }],
      open: [{ node_id: 'n1', opened: '5', human_opened: '3' }],
      click: [{ node_id: 'n3', clicked: '1', human_clicked: '1' }],
      dist: [{ node_id: 'n1', dist_active: 0, dist_waiting: 0, dist_completed: 4 }, { node_id: null, dist_active: 99 }, { node_id: 'n2', dist_active: 2 }],
      es: [{ total_entries: '10' }],
      lifeJe: { entries: 10, booked: 2, exited_booked: 1, exited_unsub: 1 },
    });
    process.env.BOT_ENGAGEMENT_WINDOW_SEC = '30';
    const r = await refreshJourney('1');
    expect(r.nodes).toBe(3);
    const n1 = byNode('n1');
    expect(n1[I.label]).toBe('Day 1');
    expect(n1[I.channel]).toBe('email');
    expect(n1[I.entries]).toBe(10); expect(n1[I.sent]).toBe(8); expect(n1[I.failed]).toBe(2); expect(n1[I.opened]).toBe(5);
    expect(n1[I.target]).toBe(0); expect(n1[I.booked]).toBe(0);
    expect(n1[I.final]).toBe(true);
    expect(n1[I.bot]).toBe(30);
    expect(n1[I.entryStats]).toBeNull();
    const n2 = byNode('n2');
    expect(n2[I.entries]).toBe(0); expect(n2[I.sent]).toBe(0);
    expect(n2[I.label]).toBe('n2');
    expect(n2[I.final]).toBe(false);
    const n3 = byNode('n3');
    expect(n3[I.type]).toBe('unknown');
    const roll = byNode('__ALL__');
    expect(roll[I.sent]).toBe(8);
    expect(roll[I.entries]).toBe(10);
    expect(roll[I.target]).toBe(10);
    expect(roll[I.booked]).toBe(2);
    expect(roll[I.distActive]).toBe(2);
    expect(roll[I.entryStats]).toBe(JSON.stringify({ total_entries: '10' }));
    const openCall = m.query.mock.calls.find(([s]) => s.includes('AS human_opened'));
    expect(openCall?.[1]).toEqual(['1', '30']);
  });
  it('gtm journeys skip distribution/entryStats and fall back to gtm_journey_entries lifecycle', async () => {
    script({ jf: { journey_id: 2, name: 'G', status: 'active', journey_type: 'gtm', nodes: [] }, lifeGe: { entries: 4, booked: 1, exited_booked: 0, exited_unsub: 0 } });
    await refreshJourney('2');
    expect(m.query.mock.calls.some(([s]) => s.includes('AS dist_snapshot'))).toBe(false);
    expect(m.query.mock.calls.some(([s]) => s.includes('pre_existing_unsub'))).toBe(false);
    expect(byNode('__ALL__')[I.entries]).toBe(4);
  });
  it('rolls back and releases on insert failure', async () => {
    script({ jf: { journey_id: 1, name: 'J', status: 'active', nodes: [] } });
    m.clientQuery.mockImplementation(async (sql) => { if (sql.includes('INSERT')) throw new Error('disk'); return { rows: [] }; });
    await expect(refreshJourney('1')).rejects.toThrow('disk');
    expect(m.clientQuery.mock.calls.map(([s]) => s)).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalledTimes(1);
  });
});

describe('computeNodesForDate', () => {
  it('returns only nodes that sent that day, with labels and booked=null', async () => {
    script({
      jf: { nodes: [{ id: 'n1', type: 'action', data: { title: 'T1' } }] },
      base: [{ node_id: 'n1', entries: '3', sent: '3', failed: '0' }, { node_id: 'n2', entries: '1', sent: '0', failed: '1' }],
      gtm: [{ node_id: 'n9', gtm_events: '4' }],
    });
    const r = await computeNodesForDate('1', '2026-01-01');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ node_id: 'n1', node_label: 'T1', node_type: 'action', booked: null, sent: 3 });
    const base = m.query.mock.calls.find(([s]) => s.includes('AS entries'));
    expect(base?.[1]).toEqual(['1', '2026-01-01']);
  });
  it('tolerates missing journey', async () => {
    script({ jf: null });
    expect(await computeNodesForDate('1', '2026-01-01')).toEqual([]);
  });
});

describe('refreshAllJourneys', () => {
  it('skips fresh journeys by status threshold (fake clock), refreshes stale/never-computed, records meta', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-03-01T12:00:00Z');
    vi.setSystemTime(now);
    const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
    const list = [
      { journey_id: 'a', status: 'active', computed_at: ago(0.01) },   // active: always refresh
      { journey_id: 'b', status: 'paused', computed_at: ago(1) },      // fresh (<6h) → skip
      { journey_id: 'c', status: 'completed', computed_at: ago(30) },  // stale (>24h) → refresh
      { journey_id: 'd', status: 'weird', computed_at: ago(2) },       // default 6h → skip
      { journey_id: 'e', status: 'draft', computed_at: null },         // never → refresh
    ];
    m.query.mockImplementation(async (sql, p) => {
      if (sql.includes('LEFT JOIN LATERAL')) return { rows: list };
      if (sql.includes('FROM journey_flows WHERE journey_id')) {
        if (p?.[0] === 'c') throw new Error('bad');
        return { rows: [{ journey_id: p?.[0], name: 'x', status: 'active', nodes: [] }] };
      }
      if (sql.includes('AS booked')) return { rows: [{ entries: 0, booked: 0, exited_booked: 0, exited_unsub: 0 }] };
      return { rows: [] };
    });
    const r = await refreshAllJourneys();
    expect(r).toMatchObject({ done: 2, skipped: 2, failed: 1 });
    const meta = m.query.mock.calls.find(([s]) => s.includes('journey_stats_meta'));
    expect(meta?.[1]?.[1]).toBe(2);
  });
  it('force refreshes everything; time budget stops early', async () => {
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('LEFT JOIN LATERAL')) return { rows: [{ journey_id: 'a', status: 'completed', computed_at: new Date().toISOString() }] };
      return { rows: [] };
    });
    expect((await refreshAllJourneys({ force: true })).done).toBe(1);
    expect((await refreshAllJourneys({ maxMs: -1 })).done).toBe(0);
  });
});
