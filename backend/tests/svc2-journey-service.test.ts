import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
type Route = [string, (params: unknown[]) => Result | Promise<Result>];

const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  enqueueBatch: vi.fn<(channel: string, jobs: Array<{ data: Record<string, unknown>; opts: { jobId: string } }>) => Promise<void>>(),
  cacheDel: vi.fn<(k: string) => Promise<void>>(),
  segGetById: vi.fn<(id: unknown) => Promise<{ conditions: unknown[] } | null>>(),
  buildSegmentSQL: vi.fn<(c: unknown, o: unknown) => { sql: string; params: unknown[] }>(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/services/queue/index.js', () => ({ enqueueBatch: m.enqueueBatch, queueCounts: vi.fn(), enqueueGtmJourney: vi.fn(), getConnection: vi.fn() }));
vi.mock('../src/config/cache.js', () => ({ del: m.cacheDel, cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/services/PopularityService.js', () => ({ default: { runIdForBucket: (j: unknown) => `run_${String(j)}_d` } }));
vi.mock('../src/services/CustomSegmentService.js', () => ({ default: { getById: m.segGetById, buildSegmentSQL: m.buildSegmentSQL } }));
vi.mock('../src/services/GtmJourneyService.js', () => ({ default: {} }));
vi.mock('../src/services/ChatHeadV1Service.js', () => ({ default: { sendBroadcast: vi.fn() } }));
vi.mock('../src/services/affinityVars.js', () => ({ getAffinityVarsMany: vi.fn(async () => new Map()) }));

import JourneyService from '../src/services/JourneyService.js';
import type { JourneyFlowNode, JourneyFlowEdge } from '../src/types/journeyService.js';

type Detail = NonNullable<Awaited<ReturnType<typeof JourneyService.getById>>>;

function route(r: Route[]) {
  m.query.mockImplementation(async (sql, params) => {
    for (const [frag, fn] of r) if (sql.includes(frag)) return fn(params ?? []);
    return { rows: [], rowCount: 0 };
  });
}
const calls = (frag: string) => m.query.mock.calls.filter(([s]) => s.includes(frag));
const rows = (r: unknown[], rowCount?: number): Result => ({ rows: r, rowCount: rowCount ?? r.length });

beforeEach(() => {
  m.query.mockReset(); m.enqueueBatch.mockReset(); m.cacheDel.mockReset(); m.segGetById.mockReset(); m.buildSegmentSQL.mockReset();
  m.cacheDel.mockResolvedValue(undefined);
  m.enqueueBatch.mockResolvedValue(undefined);
  route([]);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('JourneyService.create / update / node CRUD', () => {
  it('create: maps continuous→gtm, normalises trigger list, recType, credential, source', async () => {
    route([['INSERT INTO journey_flows', () => rows([{ journey_id: 9 }])]]);
    const j = await JourneyService.create({
      name: 'J', journeyType: 'continuous', triggerEvent: ['view_item', '', 'add_to_cart'],
      recommendationType: 'bogus', emailCredential: 'other', triggerSource: 'giveaway', nodes: [{ id: 'n0', type: 'trigger' }], edges: [],
    });
    expect(j.journey_id).toBe(9);
    const p = calls('INSERT INTO journey_flows')[0][1] ?? [];
    expect(p[16]).toBe('gtm');
    expect(p[17]).toBe('view_item,add_to_cart');
    expect(p[19]).toBeNull();
    expect(p[20]).toBe('default');
    expect(p[21]).toBe('giveaway');
    expect(p[10]).toBe('all');
    expect(p[11]).toBe(true);
    expect(p[15]).toBe(30);
    expect(p[5]).toBe(JSON.stringify([{ id: 'n0', type: 'trigger' }]));
    // no segment → no snapshot build
    expect(calls('snapshot_count = -1')).toHaveLength(0);
  });
  it('create: fixed journey ignores trigger + from-date; empty nodes/edges stored as []', async () => {
    route([['INSERT INTO journey_flows', () => rows([{ journey_id: 1 }])]]);
    await JourneyService.create({ name: 'F', journeyType: 'fixed', triggerEvent: 'view_item', triggerFromDate: '2026-01-01', exitOnConversion: false });
    const p = calls('INSERT INTO journey_flows')[0][1] ?? [];
    expect(p[16]).toBe('normal'); expect(p[17]).toBeNull(); expect(p[18]).toBeNull();
    expect(p[5]).toBe('[]'); expect(p[6]).toBe('[]');
    expect(p[11]).toBe(false);
  });
  it('create with custom segment: marks building (-1) then snapshots in background', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    m.segGetById.mockResolvedValue({ conditions: [] });
    m.buildSegmentSQL.mockReturnValue({ sql: 'SELECT uc.id, uc.is_indian FROM unified_contacts uc WHERE uc.x = $1', params: ['v'] });
    route([
      ['INSERT INTO journey_flows', () => rows([{ journey_id: 4 }])],
      ['INSERT INTO journey_entries', () => rows([], 12)],
    ]);
    const j = await JourneyService.create({ name: 'C', segmentId: 'custom:77', audience: 'indian', nodes: [{ id: 'first', type: 'trigger' }] });
    expect(j.snapshot_count).toBe(-1);
    expect(calls('INSERT INTO journey_flows')[0][1]?.[3]).toBe(77);
    expect(calls('INSERT INTO journey_entries')).toHaveLength(0);
    vi.runAllTimers();
    await vi.waitFor(() => expect(m.cacheDel).toHaveBeenCalledWith('journey:detail:4'));
    const ins = calls('INSERT INTO journey_entries')[0];
    expect(ins[0]).toContain('AND seg.is_indian = true');
    expect(ins[0]).toContain('$2, seg.id, $3');
    expect(ins[1]).toEqual(['v', 4, 'first']);
    expect(calls('SET snapshot_count = $1, total_entries = $1')[0][1]).toEqual([12, 4]);
  });
  it('create: snapshot failure flags -2', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    m.segGetById.mockResolvedValue(null);
    route([['INSERT INTO journey_flows', () => rows([{ journey_id: 5 }])]]);
    await JourneyService.create({ name: 'C', segmentId: 'custom:1' });
    vi.runAllTimers();
    await vi.waitFor(() => expect(calls('snapshot_count = -2')).toHaveLength(1));
  });
  // SUSPECTED BUG / missing validation: create() persists any graph — edges pointing at
  // nodes that don't exist, duplicate node ids — with no validation (JourneyService.ts:1133-1171).
  it('create rejects edges that reference unknown nodes', async () => {
    route([['INSERT INTO journey_flows', () => rows([{ journey_id: 1 }])]]);
    await expect(JourneyService.create({ name: 'bad', nodes: [{ id: 'a', type: 'trigger' }], edges: [{ source: 'a', target: 'ghost' }] })).rejects.toThrow();
  });
  it('update: only whitelisted fields, JSON for nodes/edges; gtm never re-snapshots', async () => {
    route([['UPDATE journey_flows SET', () => rows([{ journey_id: 3, journey_type: 'gtm', segment_id: 5, nodes: [] }])]]);
    await JourneyService.update(3, { name: 'x', nodes: [{ id: 'a' }], evil: 'DROP', segment_id: 5 });
    const [sql, p] = calls('UPDATE journey_flows SET')[0];
    expect(sql).toContain('name = $2, segment_id = $3, nodes = $4');
    expect(sql).not.toContain('evil');
    expect(p).toEqual([3, 'x', 5, JSON.stringify([{ id: 'a' }])]);
    expect(calls("DELETE FROM journey_entries WHERE journey_id = $1 AND status = 'snapshot'")).toHaveLength(1);
    expect(calls('FROM   segment_customers')).toHaveLength(0);
  });
  it('update: normal journey segment change rebuilds std snapshot with audience filter', async () => {
    route([
      ['UPDATE journey_flows SET name', () => rows([])],
      ['UPDATE journey_flows SET audience', () => rows([{ journey_id: 3, journey_type: 'normal', segment_id: 5, audience: 'rest', nodes: [{ id: 'n1' }] }])],
      ['INSERT INTO journey_entries', () => rows([], 3)],
    ]);
    await JourneyService.update(3, { audience: 'rest' });
    const ins = calls('INSERT INTO journey_entries')[0];
    expect(ins[0]).toContain('AND uc.is_indian = false');
    expect(ins[1]).toEqual([3, 'n1', 5]);
  });
  it('deleteNode stitches incoming → outgoing without duplicates', async () => {
    const nodes: JourneyFlowNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges: JourneyFlowEdge[] = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'c' }];
    vi.spyOn(JourneyService, 'getById').mockResolvedValue({ journey_id: 1, nodes, edges } as unknown as Detail);
    const upd = vi.spyOn(JourneyService, 'update').mockResolvedValue(null);
    await JourneyService.deleteNode(1, 'b');
    const f = upd.mock.calls[0][1] as { nodes: JourneyFlowNode[]; edges: JourneyFlowEdge[] };
    expect(f.nodes.map(n => n.id)).toEqual(['a', 'c']);
    expect(f.edges).toEqual([{ source: 'a', target: 'c' }]);
  });
  it('addNode wires edge from last node (or given node) and generates id', async () => {
    vi.spyOn(JourneyService, 'getById').mockResolvedValue({ journey_id: 1, nodes: [{ id: 'a' }, { id: 'b' }], edges: [] } as unknown as Detail);
    const upd = vi.spyOn(JourneyService, 'update').mockResolvedValue(null);
    await JourneyService.addNode(1, { id: '', type: 'wait' });
    const f = upd.mock.calls[0][1] as { nodes: JourneyFlowNode[]; edges: JourneyFlowEdge[] };
    const newId = f.nodes[2].id;
    expect(newId).toMatch(/^node_\d+_/);
    expect(f.edges[0]).toMatchObject({ source: 'b', target: newId });
  });
  it('node CRUD throws when journey missing', async () => {
    vi.spyOn(JourneyService, 'getById').mockResolvedValue(null);
    await expect(JourneyService.updateNode(1, 'a', {})).rejects.toThrow('Journey not found');
  });
});

describe('JourneyService timing helpers', () => {
  it('calculateNextFireAt: wait nodes add days (0 honoured), actions fire now or at Dubai sendHour', () => {
    const from = new Date('2026-04-10T02:00:00Z'); // 06:00 Dubai
    expect(JourneyService.calculateNextFireAt(null, from)).toBeNull();
    expect(JourneyService.calculateNextFireAt({ id: 'w', type: 'wait', data: { waitDays: 2 } }, from)?.toISOString()).toBe('2026-04-12T02:00:00.000Z');
    expect(JourneyService.calculateNextFireAt({ id: 'w', type: 'wait', data: { waitDays: 0 } }, from)?.toISOString()).toBe(from.toISOString());
    expect(JourneyService.calculateNextFireAt({ id: 'w', type: 'wait' }, from)?.toISOString()).toBe('2026-04-11T02:00:00.000Z');
    expect(JourneyService.calculateNextFireAt({ id: 'a', type: 'action', data: { waitDays: 5 } }, from)?.toISOString()).toBe(from.toISOString());
    expect(JourneyService.calculateNextFireAt({ id: 'a', type: 'action', data: { sendHour: 10 } }, from)?.toISOString()).toBe('2026-04-10T06:00:00.000Z');
    // sendHour already passed → same day (past timestamp = due now), never bumped
    expect(JourneyService.calculateNextFireAt({ id: 'a', type: 'action', data: { sendHour: '05:30' } }, from)?.toISOString()).toBe('2026-04-10T01:30:00.000Z');
  });
  it('calculateNextFireAt: Dubai day boundary uses Dubai date (UTC 22:00 = next Dubai day)', () => {
    const from = new Date('2026-04-10T22:00:00Z'); // 02:00 Dubai on Apr 11
    expect(JourneyService.calculateNextFireAt({ id: 'a', type: 'action', data: { sendHour: 9 } }, from)?.toISOString()).toBe('2026-04-11T05:00:00.000Z');
  });
  // BUG: a blank/garbage sendHour (e.g. '' from a cleared UI field) is not treated as "unset":
  // parseInt('') = NaN → returns an Invalid Date, which is then written to next_fire_at.
  // JourneyService.ts:2996-3008.
  it('calculateNextFireAt never returns an Invalid Date for blank sendHour', () => {
    const r = JourneyService.calculateNextFireAt({ id: 'a', type: 'action', data: { sendHour: '' } }, new Date('2026-01-01T00:00:00Z'));
    expect(Number.isNaN(r?.getTime())).toBe(false);
  });
  it('_findFirstActionableNode follows trigger edge, falls back sensibly', () => {
    const nodes: JourneyFlowNode[] = [{ id: 't', type: 'trigger' }, { id: 'x' }, { id: 'y' }];
    expect(JourneyService._findFirstActionableNode(nodes, [{ source: 't', target: 'y' }])?.id).toBe('y');
    expect(JourneyService._findFirstActionableNode(nodes, [])?.id).toBe('x');
    expect(JourneyService._findFirstActionableNode([{ id: 'only', type: 'trigger' }], [])?.id).toBe('only');
    expect(JourneyService._findFirstActionableNode([], [])).toBeNull();
  });
  it('_advanceEntry prefers track-matched edge, completes when no edge', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const nodeMap: Record<string, JourneyFlowNode> = {
      a: { id: 'a' }, in: { id: 'in', type: 'wait', data: { track: 'indian', waitDays: 1 } }, rest: { id: 'rest', type: 'action', data: { track: 'rest' } },
    };
    const edges: JourneyFlowEdge[] = [{ source: 'a', target: 'rest' }, { source: 'a', target: 'in' }];
    await JourneyService._advanceEntry(1, 'a', edges, nodeMap, 'indian');
    const [, p] = calls('SET current_node_id = $1')[0];
    expect(p?.[0]).toBe('in');
    expect((p?.[1] as Date).toISOString()).toBe('2026-01-02T00:00:00.000Z');
    await JourneyService._advanceEntry(2, 'rest', edges, nodeMap, 'indian');
    expect(calls("status = 'completed'")[0][1]).toEqual([2]);
  });
});

describe('JourneyService exit / conversion', () => {
  it('checkConversion: booked/confirmed (any case), unsubscribed (any case), none, missing contact', async () => {
    const contact = { v: { booking_status: 'CONFIRMED', email_unsubscribe: null } as Record<string, unknown> | null };
    route([['SELECT booking_status, email_unsubscribe', () => rows(contact.v ? [contact.v] : [])]]);
    expect(await JourneyService.checkConversion({ customer_id: 1 })).toMatchObject({ converted: true, reason: 'booked' });
    contact.v = { booking_status: 'enquiry', email_unsubscribe: 'YES' };
    expect(await JourneyService.checkConversion({ customer_id: 1 })).toMatchObject({ converted: true, reason: 'unsubscribed' });
    contact.v = { booking_status: null, email_unsubscribe: 'no' };
    expect(await JourneyService.checkConversion({ customer_id: 1 })).toEqual({ converted: false, reason: null });
    contact.v = null;
    expect(await JourneyService.checkConversion({ customer_id: 1 })).toEqual({ converted: false, reason: null });
  });
  it('checkConversions: missing journey null; sums ga4 + offline and recomputes rate with zero guard', async () => {
    expect(await JourneyService.checkConversions(1)).toBeNull();
    route([
      ['SELECT * FROM journey_flows', () => rows([{ journey_id: 1 }])],
      ["conversion_event = 'ga4_purchase'", () => rows([{ id: 1 }, { id: 2 }])],
      ["conversion_event = 'offline_booking'", () => rows([{ id: 3 }])],
    ]);
    expect(await JourneyService.checkConversions(1)).toEqual({ ga4_conversions: 2, offline_conversions: 1, total_converted: 3 });
    expect(calls('conversion_rate = CASE')[0][0]).toContain('> 0');
  });
  // BUG (attribution window): conversions are attributed if the purchase happened after the
  // EARLIEST enrollment in the whole journey (MIN(enrolled_at)), not after THIS contact's own
  // enrollment — so a late enrollee's pre-enrollment purchase counts as a journey conversion.
  // JourneyService.ts:2893 and :2914.
  it('conversion window is per-enrollment (je.enrolled_at), not journey-wide MIN', async () => {
    route([['SELECT * FROM journey_flows', () => rows([{ journey_id: 1 }])]]);
    await JourneyService.checkConversions(1);
    expect(calls("conversion_event = 'ga4_purchase'")[0][0]).not.toContain('MIN(enrolled_at)');
  });
  it('processDueEntries: converts booked entries, then processes each journey once', async () => {
    route([
      ['FROM journey_entries je\n      JOIN journey_flows jf', () => rows([
        { entry_id: 1, journey_id: 10, customer_id: 100, current_node_id: 'a', exit_on_conversion: true },
        { entry_id: 2, journey_id: 10, customer_id: 101, current_node_id: 'a', exit_on_conversion: true },
        { entry_id: 3, journey_id: 11, customer_id: 102, current_node_id: 'a', exit_on_conversion: false },
      ])],
      ['SELECT booking_status, email_unsubscribe', (p) => rows([{ booking_status: p[0] === 100 ? 'booked' : null, email_unsubscribe: null }])],
    ]);
    const pj = vi.spyOn(JourneyService, 'processJourney').mockResolvedValue({ processed: 0, actioned: 0, waited: 0, conditioned: 0, converted: 0, enqueued: 0, runId: 'r' });
    const r = await JourneyService.processDueEntries();
    expect(r).toEqual({ processed: 3, sent: 2, converted: 1, completed: 0 });
    expect(calls("SET status = 'converted'")[0][1]).toEqual([1, 'booked']);
    expect(calls('SELECT booking_status, email_unsubscribe')).toHaveLength(2);
    expect(pj.mock.calls.map(c => c[0])).toEqual([10, 11]);
  });
  it('processDueEntries: nothing due', async () => {
    expect(await JourneyService.processDueEntries()).toEqual({ processed: 0, sent: 0, converted: 0, completed: 0 });
  });
});

describe('JourneyService.startJourney', () => {
  const base = { journey_id: 1, status: 'draft', nodes: [{ id: 'n' }], snapshot_count: 5 };
  it.each([
    [null, 'Journey not found'],
    [{ ...base, status: 'active' }, 'already active'],
    [{ ...base, snapshot_count: -1 }, 'still being built'],
    [{ ...base, snapshot_count: -2 }, 'build failed'],
    [{ ...base, nodes: [] }, 'no nodes'],
  ])('rejects invalid state %#', async (j, msg) => {
    route([['SELECT * FROM journey_flows', () => rows(j ? [j] : [])]]);
    await expect(JourneyService.startJourney(1)).rejects.toThrow(msg);
  });
  it('rejects past schedule unless manual (fake clock)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    route([
      ['SELECT * FROM journey_flows', () => rows([{ ...base, scheduled_start_at: '2026-05-01T00:00:00Z' }])],
      ['COUNT(*) AS cnt', () => rows([{ cnt: '0' }])],
    ]);
    await expect(JourneyService.startJourney(1)).rejects.toThrow('already passed');
    await expect(JourneyService.startJourney(1, { manual: true })).rejects.toThrow('No users snapshotted');
  });
  it('activates snapshot entries, sets next_fire_at, runs two process passes', async () => {
    route([
      ['SELECT * FROM journey_flows', () => rows([base])],
      ['COUNT(*) AS cnt', () => rows([{ cnt: '5' }])],
      ["SET status = 'active' WHERE journey_id = $1 AND status = 'snapshot'", () => rows([], 5)],
    ]);
    const pj = vi.spyOn(JourneyService, 'processJourney')
      .mockResolvedValueOnce({ processed: 5, actioned: 0, waited: 0, conditioned: 0, converted: 1, enqueued: 0, runId: 'r' })
      .mockResolvedValueOnce({ processed: 4, actioned: 4, waited: 0, conditioned: 0, converted: 0, enqueued: 4, runId: 'r' });
    const r = await JourneyService.startJourney(1, { manual: true });
    expect(r).toMatchObject({ started: true, enrolled: 5, enqueued: 4, converted: 1 });
    expect(pj).toHaveBeenCalledTimes(2);
    expect(calls('scheduled_start_at = NULL')).toHaveLength(1);
    expect(calls('SET next_fire_at = NOW()')).toHaveLength(1);
  });
});

describe('JourneyService.processJourney', () => {
  const nodes: JourneyFlowNode[] = [
    { id: 'trig', type: 'trigger' },
    { id: 'wait', type: 'wait', data: { waitDays: 3 } },
    { id: 'email', type: 'action', data: { channel: 'email', templateId: 7 } },
    { id: 'broken', type: 'action', data: { channel: 'email' } },
    { id: 'cond', type: 'condition', data: { condition: 'opened_email' } },
    { id: 'yes', type: 'goal' },
    { id: 'no', type: 'action', data: { channel: 'sms', templateId: 8 } },
  ];
  const edges: JourneyFlowEdge[] = [
    { source: 'trig', target: 'wait' }, { source: 'wait', target: 'email' }, { source: 'broken', target: 'cond' },
    { source: 'cond', target: 'yes', label: 'Yes' }, { source: 'cond', target: 'no', label: 'No' },
  ];
  function setup(journey: Record<string, unknown>, entries: unknown[], extra: Route[] = []) {
    vi.spyOn(JourneyService, '_prewarmRankingCache').mockResolvedValue(undefined);
    vi.spyOn(JourneyService, '_refreshAddNew').mockResolvedValue(undefined);
    vi.spyOn(JourneyService, '_refreshExitStale').mockResolvedValue(undefined);
    vi.spyOn(JourneyService, '_resolveHtmlTemplateId').mockResolvedValue(null);
    route([
      ...extra,
      ['SELECT * FROM journey_flows', () => rows([{ journey_id: 1, status: 'active', nodes, edges, ...journey }])],
      ['SELECT je.*, uc.name', (p) => rows(p[2] === 0 ? entries : [])],
      ['active_cnt', () => rows([{ active_cnt: '1' }])],
      ['has_opened', () => rows([{ has_opened: true }])],
    ]);
  }
  it('gtm journeys are never engine-processed', async () => {
    setup({ journey_type: 'gtm' }, []);
    expect(await JourneyService.processJourney(1)).toMatchObject({ skipped: 'gtm', processed: 0 });
    expect(m.enqueueBatch).not.toHaveBeenCalled();
  });
  it('bulk exits booked/unsubscribed/purchased and counts conversions; skipped when exit_on_conversion=false', async () => {
    setup({}, [], [
      ["exit_reason = 'booked'", () => rows([{ entry_id: 1, current_node_id: 'email' }])],
      ["exit_reason = 'unsubscribed'", () => rows([{ entry_id: 2, current_node_id: 'email' }, { entry_id: 3, current_node_id: 'wait' }])],
      ["exit_reason = 'purchased'", () => rows([{ entry_id: 4, current_node_id: 'no' }])],
    ]);
    const r = await JourneyService.processJourney(1);
    expect(r.converted).toBe(3);
    expect(calls("exit_reason = 'purchased'")[0][1]).toEqual([1, 'email']);
    expect(calls('INSERT INTO journey_events')).toHaveLength(4);
    m.query.mockClear();
    setup({ exit_on_conversion: false }, []);
    await JourneyService.processJourney(1);
    expect(calls("exit_reason = 'booked'")).toHaveLength(0);
  });
  // BUG: the bulk unsubscribe exit compares `uc.email_unsubscribe = 'Yes'` case-sensitively,
  // but checkConversion() documents that syncs store 'Yes' / 'yes' / 'YES'. Lower/upper-case
  // opt-outs are NOT exited by processJourney and stay on the send path. JourneyService.ts:1703.
  it('bulk unsubscribe exit is case-insensitive', async () => {
    setup({}, []);
    await JourneyService.processJourney(1);
    expect(calls("exit_reason = 'unsubscribed'")[0][0]).toMatch(/LOWER\(uc\.email_unsubscribe\)|ILIKE/);
  });
  it('wait node: legacy entry (no next_fire_at) waits until elapsed, then advances with wait time', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-10T00:00:00Z'));
    setup({}, [
      { entry_id: 1, current_node_id: 'wait', next_fire_at: null, entered_at: '2026-02-09T00:00:00Z' },
      { entry_id: 2, current_node_id: 'wait', next_fire_at: null, entered_at: '2026-02-01T00:00:00Z' },
      { entry_id: 3, current_node_id: 'trig', next_fire_at: null, entered_at: '2026-02-01T00:00:00Z' },
    ]);
    const r = await JourneyService.processJourney(1);
    expect(r.waited).toBe(1);
    const moves = calls('SET current_node_id = $1');
    expect(moves.map(([, p]) => [p?.[0], p?.[2]])).toEqual([['email', 2], ['wait', 3]]);
    // arriving at wait node → fire 3 days later
    expect((moves[1][1]?.[1] as Date).toISOString()).toBe('2026-02-13T00:00:00.000Z');
  });
  it('action node: enqueues per channel with unique jobId, stamps entries; misconfigured node is blocked + advanced; test mode redirects', async () => {
    setup({ test_mode: true, test_email: 'qa@x.com', email_credential: 'giveaway' }, [
      { entry_id: 1, customer_id: 100, current_node_id: 'email', email: 'real@x.com', track: 'indian' },
      { entry_id: 2, customer_id: 101, current_node_id: 'broken', email: 'b@x.com' },
      { entry_id: 3, customer_id: 102, current_node_id: 'email', email: 'c@x.com', last_enqueued_at: new Date().toISOString() },
    ]);
    const r = await JourneyService.processJourney(1);
    expect(r).toMatchObject({ actioned: 1, enqueued: 1, processed: 3 });
    const [ch, jobs] = m.enqueueBatch.mock.calls[0];
    expect(ch).toBe('email');
    expect(jobs[0].opts.jobId).toBe('1_1_email_run_1_d');
    expect(jobs[0].data).toMatchObject({ email: 'qa@x.com', emailCredential: 'giveaway', templateId: 7, firstActionNodeId: 'email', track: 'indian' });
    const blocked = calls("'action_blocked'")[0][1] ?? [];
    expect(String(blocked[3])).toContain('missing_channel_or_template');
    expect(calls('SET current_node_id = $1')[0][1]?.[0]).toBe('cond');
    expect(calls('SET last_run_id = $1, last_enqueued_at = NOW()')[0][1]).toEqual(['run_1_d', [1]]);
  });
  it('enqueue failure un-stamps entries so they retry next tick', async () => {
    setup({}, [{ entry_id: 9, customer_id: 1, current_node_id: 'email', email: 'a@x' }]);
    m.enqueueBatch.mockRejectedValue(new Error('redis down'));
    const r = await JourneyService.processJourney(1);
    expect(r.enqueued).toBe(0);
    expect(calls('SET last_run_id = NULL, last_enqueued_at = NULL')[0][1]).toEqual([[9], 'run_1_d']);
  });
  it('condition node routes Yes/No by result; goal completes', async () => {
    setup({}, [
      { entry_id: 1, current_node_id: 'cond' },
      { entry_id: 2, current_node_id: 'yes' },
    ]);
    const r = await JourneyService.processJourney(1);
    expect(r.conditioned).toBe(1);
    expect(calls('SET current_node_id = $1')[0][1]?.[0]).toBe('yes');
    expect(String(calls("'condition_evaluated'")[0][1]?.[2])).toBe(JSON.stringify({ condition: 'opened_email', result: true }));
    expect(calls("SET status = 'completed', completed_at = NOW()\n")[0]?.[1] ?? calls("UPDATE journey_entries SET status = 'completed'")[0][1]).toEqual([2]);
  });
  it('auto-completes journey when no active entries remain; conversion_rate guarded', async () => {
    setup({}, [], [['active_cnt', () => rows([{ active_cnt: '0' }])]]);
    await JourneyService.processJourney(1);
    expect(calls("SET status = 'completed', updated_at = NOW()")).toHaveLength(1);
    expect(calls('conversion_rate = CASE WHEN total_entries > 0')).toHaveLength(1);
  });
});
