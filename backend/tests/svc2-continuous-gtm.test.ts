import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
type Route = [string, (params: unknown[]) => unknown[] | Promise<unknown[]>];
interface Cap { allowed: boolean; count: number }
interface BroadcastResult { success: boolean; error?: string; broadcast?: { id: number; chatheadBroadcastId: number } }

const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  enqueueGtm: vi.fn<(data: Record<string, unknown>, delay: number) => Promise<void>>(),
  sismember: vi.fn<(k: string, v: string) => Promise<number>>(),
  sadd: vi.fn<(k: string, v: string) => Promise<number>>(),
  broadcast: vi.fn<(a: { contacts: Array<{ phone: string; vars: Record<string, unknown> }>; channelId: number; templateId: number }) => Promise<BroadcastResult>>(),
  sendRCS: vi.fn<(a: Record<string, unknown>) => Promise<{ success: boolean; simulated?: boolean; externalId?: string }>>(),
  reserveSend: vi.fn<(t: Record<string, unknown>) => Promise<Cap>>(),
  releaseSend: vi.fn(),
  reserveWaSend: vi.fn<(t: Record<string, unknown>) => Promise<Cap>>(),
  releaseWaSend: vi.fn(),
  affMany: vi.fn<(ids: unknown[]) => Promise<Map<string, Record<string, string>>>>(),
  aff: vi.fn<(id: unknown) => Promise<Record<string, string>>>(),
  sendEmail: vi.fn<(a: { emailCredential?: string; to: string; subject: string; html: string }) => Promise<{ success: boolean; provider?: string; externalId?: string; error?: string }>>(),
  logSend: vi.fn<(a: Record<string, unknown>) => Promise<number>>(),
  markSent: vi.fn<(id: unknown, a: Record<string, unknown>) => Promise<void>>(),
  markFailed: vi.fn<(id: unknown, a: Record<string, unknown>) => Promise<void>>(),
  skipRecord: vi.fn(),
  segRows: vi.fn<(j: unknown) => Promise<{ sql: string; params: unknown[] } | null>>(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/services/queue/index.js', () => ({
  enqueueGtmJourney: m.enqueueGtm,
  getConnection: () => ({ sismember: m.sismember, sadd: m.sadd }),
  enqueueBatch: vi.fn(), queueCounts: vi.fn(),
}));
vi.mock('../src/services/ChatHeadV1Service.js', () => ({ default: { sendBroadcast: m.broadcast } }));
vi.mock('../src/services/GupshupService.js', () => ({ default: { sendRCS: m.sendRCS } }));
vi.mock('../src/services/WelcomeEmailService.js', () => ({ default: {} }));
vi.mock('../src/utils/emailFrequencyCap.js', () => ({
  reserveSend: m.reserveSend, releaseSend: m.releaseSend, reserveWaSend: m.reserveWaSend, releaseWaSend: m.releaseWaSend,
}));
vi.mock('../src/services/affinityVars.js', () => ({ getAffinityVarsMany: m.affMany, getAffinityVars: m.aff, usesAffinity: () => false }));
vi.mock('../src/utils/reviewUrl.js', () => ({ buildReviewUrl: async () => 'https://review' }));
vi.mock('../src/services/channels/JourneyEmailSender.js', () => ({ sendJourneyEmail: m.sendEmail }));
vi.mock('../src/services/SendTrackService.js', () => ({ SendTrackService: { logSend: m.logSend, markSent: m.markSent, markFailed: m.markFailed } }));
vi.mock('../src/services/SkipLogService.js', () => ({ default: { record: m.skipRecord } }));
vi.mock('../src/services/LiquidRenderer.js', () => ({ default: { render: async (t: string) => t } }));
vi.mock('../src/services/JourneyService.js', () => ({ default: { _journeySegmentRows: m.segRows } }));
vi.mock('../src/services/RecommendationRenderer.js', () => ({ injectPerUserProducts: vi.fn(), isRecipientAllowedForRec: () => true }));

import ContinuousJourneyService from '../src/services/ContinuousJourneyService.js';
import GtmJourneyService from '../src/services/GtmJourneyService.js';
import type { ContinuousWaNode } from '../src/types/services_B_continuous.js';

let routes: Route[] = [];
function route(r: Route[]) {
  routes = r;
  m.query.mockImplementation(async (sql, params) => {
    for (const [frag, fn] of routes) if (sql.includes(frag)) return { rows: await fn(params ?? []) };
    return { rows: [] };
  });
}
const calls = (frag: string) => m.query.mock.calls.filter(([s]) => s.includes(frag));

// Flow: trigger → wait(2d) → a1 → a2(wa) → goal
const FLOW = {
  nodes: [
    { id: 't', type: 'trigger' },
    { id: 'w', type: 'wait', data: { waitDays: 2 } },
    { id: 'a1', type: 'action', data: { channel: 'email', emailTemplateId: 5 } },
    { id: 'a2', type: 'action', data: { channel: 'whatsapp', waChannelId: '3', waTemplateId: '9', waTemplateName: 'tpl' } },
    { id: 'g', type: 'goal' },
  ],
  edges: [{ source: 't', target: 'w' }, { source: 'w', target: 'a1' }, { source: 'a1', target: 'a2' }, { source: 'a2', target: 'g' }],
};

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  route([]);
  m.reserveSend.mockResolvedValue({ allowed: true, count: 0 });
  m.reserveWaSend.mockResolvedValue({ allowed: true, count: 0 });
  m.affMany.mockResolvedValue(new Map());
  m.aff.mockResolvedValue({});
  m.logSend.mockResolvedValue(101);
  m.markSent.mockResolvedValue(undefined);
  m.markFailed.mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  delete process.env.JOURNEY_WAIT_SECS_PER_DAY;
  process.env.WELCOME_EMAILS = '';
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('GtmJourneyService flow walking', () => {
  it('_waitMs: days → ms, test override secs-per-day', () => {
    expect(GtmJourneyService._waitMs(2)).toBe(2 * 86_400_000);
    expect(GtmJourneyService._waitMs('0.5')).toBe(43_200_000);
    process.env.JOURNEY_WAIT_SECS_PER_DAY = '10';
    expect(GtmJourneyService._waitMs(3)).toBe(30_000);
  });
  // BUG: `parseFloat(waitDays) || 1` turns an explicit 0-day wait into a 1-day wait
  // (0 is falsy). GtmJourneyService.ts:52.
  it('_waitMs(0) is zero, not one day', () => {
    expect(GtmJourneyService._waitMs(0)).toBe(0);
  });
  it('_nextStep sums waits until the next action, stops at goal/end', () => {
    expect(GtmJourneyService._nextStep(FLOW.nodes, FLOW.edges, 't')).toEqual({ nodeId: 'a1', delayMs: 2 * 86_400_000 });
    expect(GtmJourneyService._nextStep(FLOW.nodes, FLOW.edges, 'a1')).toEqual({ nodeId: 'a2', delayMs: 0 });
    expect(GtmJourneyService._nextStep(FLOW.nodes, FLOW.edges, 'a2')).toBeNull();
    expect(GtmJourneyService._nextStep(FLOW.nodes, FLOW.edges, 'g')).toBeNull();
    expect(GtmJourneyService._nextStep(FLOW.nodes, [{ source: 't', target: 'missing' }], 't')).toBeNull();
  });
  it('_nextStep terminates on wait cycles', () => {
    const nodes = [{ id: 'w1', type: 'wait' }, { id: 'w2', type: 'wait' }];
    const edges = [{ source: 'w1', target: 'w2' }, { source: 'w2', target: 'w1' }];
    expect(GtmJourneyService._nextStep(nodes, edges, 'w1')).toBeNull();
  });
  it('_dedupKey format', () => {
    expect(GtmJourneyService._dedupKey(1, 2, null)).toBe('gtmj:j1:u2:n1');
  });
});

describe('GtmJourneyService enrolment', () => {
  it('onEvent: segment members only, first node after trigger with leading wait delay', async () => {
    route([
      ['FROM journey_flows', () => [{ journey_id: 7, ...FLOW }, { journey_id: 8, ...FLOW }]],
      ['INSERT INTO gtm_journey_entries', () => [{ id: 55 }]],
      ['SELECT 1 FROM (', (p) => (p[p.length - 1] === 42 ? [{ x: 1 }] : [])],
    ]);
    m.segRows.mockImplementation(async (j) => ((j as { journey_id: number }).journey_id === 7 ? { sql: 'SELECT id FROM seg WHERE a = $1', params: ['x'] } : null));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
    await GtmJourneyService.onEvent({ eventName: 'view_item', unifiedId: 42, eventId: 9, itemId: 'P1' });
    const ins = calls('INSERT INTO gtm_journey_entries');
    expect(ins).toHaveLength(1);
    const p = ins[0][1] ?? [];
    expect(p.slice(0, 4)).toEqual([7, 42, 'P1', 'a1']);
    expect((p[5] as Date).toISOString()).toBe('2026-05-03T00:00:00.000Z');
    expect(calls('SELECT 1 FROM (')[0][0]).toContain('m.id = $2');
  });
  it('onEvent: no event name / uid → no query', async () => {
    await GtmJourneyService.onEvent({ eventName: '', unifiedId: 1 });
    expect(m.query).not.toHaveBeenCalled();
  });
  it('enqueueForStart dedups per item at node 1', async () => {
    m.sismember.mockImplementation(async (_k, v) => (v === 'dup' ? 1 : 0));
    const n = await GtmJourneyService.enqueueForStart(3, [{ unifiedId: 1, eventId: 1, itemId: 'dup' }, { unifiedId: 1, eventId: 2, itemId: 'new' }, { unifiedId: 2, eventId: 3 }], 'a1');
    expect(n).toBe(2);
    expect(m.sadd.mock.calls.map(c => c[1])).toEqual(['new', '_noitem']);
    expect(m.enqueueGtm.mock.calls[0][1]).toBe(120_000);
  });
});

describe('ContinuousJourneyService', () => {
  it('enter: requires ids, clamps negative delay, returns null on conflict', async () => {
    expect(await ContinuousJourneyService.enter({ journeyId: 1, unifiedId: 0, firstNodeId: 'a' })).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    route([['INSERT INTO gtm_journey_entries', () => []]]);
    expect(await ContinuousJourneyService.enter({ journeyId: 1, unifiedId: 2, firstNodeId: 'a', entryDelayMs: -500 })).toBeNull();
    const p = m.query.mock.calls[0][1] ?? [];
    expect((p[5] as Date).getTime()).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(p[2]).toBe('_noitem');
    expect(m.query.mock.calls[0][0]).toContain('ON CONFLICT (journey_id, unified_id, item_id) DO NOTHING');
  });
  it('advance: moves to next action with wait delay, or completes at end', async () => {
    route([['SELECT nodes, edges FROM journey_flows', () => [FLOW]]]);
    expect(await ContinuousJourneyService.advance(1, 7, 't')).toEqual({ advancedTo: 'a1', delayMs: 172_800_000 });
    const up = calls('SET current_node_id=$2')[0];
    expect(up[1]).toEqual([1, 'a1', '172800000']);
    expect(up[0]).toContain('last_enqueued_at=NULL');
    expect(await ContinuousJourneyService.advance(1, 7, 'a2')).toEqual({ completed: true });
    expect(calls("status='completed'")).toHaveLength(1);
  });
  it('_exitReason: unsubscribed, purchased item, none', async () => {
    route([
      ['SELECT email_unsubscribe', (p) => [{ email_unsubscribe: p[0] === 1 ? 'YES' : 'No' }]],
      ["event_name = 'purchase'", (p) => (p[1] === 'bought' ? [{ '?column?': 1 }] : [])],
    ]);
    expect(await ContinuousJourneyService._exitReason(1, 'x')).toBe('unsubscribed');
    expect(await ContinuousJourneyService._exitReason(2, 'bought')).toBe('purchased');
    expect(await ContinuousJourneyService._exitReason(2, 'other')).toBeNull();
    m.query.mockClear();
    expect(await ContinuousJourneyService._exitReason(2, '_noitem')).toBeNull();
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  // SUSPECTED BUG: the per-item purchase exit has no attribution window — a purchase of the
  // same item from ANY time in the past (even long before the user entered the journey)
  // exits them. ContinuousJourneyService.ts:291-294 (same in GtmJourneyService.ts:198-203).
  it('purchase exit only counts purchases after entering the journey', async () => {
    route([['SELECT email_unsubscribe', () => [{}]]]);
    await ContinuousJourneyService._exitReason(2, 'item');
    expect(calls("event_name = 'purchase'")[0][0]).toMatch(/entered_at|created_at\s*>=/);
  });
  it('processDue: nothing due → zeros', async () => {
    expect(await ContinuousJourneyService.processDue()).toEqual({ due: 0, enqueued: 0, exited: 0, waBroadcasts: 0, waSent: 0 });
    expect(m.query.mock.calls[0][0]).toContain('FOR UPDATE OF e2 SKIP LOCKED');
  });
  it('processDue: email rows enqueue, unsubscribed exit; WA rows batched into one broadcast', async () => {
    route([
      ['UPDATE gtm_journey_entries e', () => [
        { id: 1, journey_id: 7, unified_id: '10', item_id: '_noitem', current_node_id: 'a1', last_event_id: '500' },
        { id: 2, journey_id: 7, unified_id: '11', item_id: '_noitem', current_node_id: 'a1', last_event_id: null },
        { id: 3, journey_id: 7, unified_id: '12', item_id: '_noitem', current_node_id: 'a2', last_event_id: null },
        { id: 4, journey_id: 7, unified_id: '13', item_id: '_noitem', current_node_id: 'a2', last_event_id: null },
        { id: 5, journey_id: 7, unified_id: '14', item_id: '_noitem', current_node_id: 'a2', last_event_id: null },
        { id: 6, journey_id: 7, unified_id: '15', item_id: '_noitem', current_node_id: 'a2', last_event_id: null },
      ]],
      ['SELECT journey_id, nodes FROM journey_flows', () => [{ journey_id: 7, nodes: FLOW.nodes }]],
      ['SELECT nodes, edges FROM journey_flows', () => [FLOW]],
      ['SELECT email_unsubscribe', (p) => [{ email_unsubscribe: p[0] === '11' ? 'yes' : null }]],
      ['FROM unified_contacts WHERE id = ANY', () => [
        { id: '12', name: 'A', email: 'a@x', mobile: '+971 50 123 4567', wa_unsubscribe: null },
        { id: '13', name: 'B', email: 'b@x', mobile: '123', wa_unsubscribe: null },
        { id: '14', name: 'C', email: 'c@x', mobile: '971501234568', wa_unsubscribe: 'Yes' },
        { id: '15', name: 'D', email: 'd@x', mobile: '971501234569', wa_unsubscribe: null },
      ]],
    ]);
    m.reserveWaSend.mockImplementation(async (t) => ({ allowed: t.unifiedId !== '15', count: 3 }));
    m.broadcast.mockResolvedValue({ success: true, broadcast: { id: 1, chatheadBroadcastId: 77 } });
    const r = await ContinuousJourneyService.processDue();
    expect(r).toEqual({ due: 6, enqueued: 1, exited: 1, waBroadcasts: 1, waSent: 1 });
    expect(m.enqueueGtm.mock.calls[0][0]).toMatchObject({ entryId: 1, nodeId: 'a1', eventId: '500' });
    expect(calls("status='exited'")[0][1]).toEqual([2, 'unsubscribed']);
    expect(m.broadcast).toHaveBeenCalledTimes(1);
    const b = m.broadcast.mock.calls[0][0];
    expect(b.contacts.map(c => c.phone)).toEqual(['971501234567']);
    expect(b.channelId).toBe(3); expect(b.templateId).toBe(9);
    const blocked = calls('INSERT INTO journey_events').map(([, p]) => JSON.parse(String(p?.[3])) as { reason?: string });
    expect(blocked.map(x => x.reason)).toEqual(expect.arrayContaining(['no_mobile', 'frequency_capped']));
    const wlog = calls('INSERT INTO whatsapp_send_log');
    expect(wlog).toHaveLength(1);
    expect(wlog[0][1]?.[10]).toBe('sent');
    expect(wlog[0][1]?.[9]).toBe('77');
    // all 4 WA entries (sent, no mobile, wa opt-out, capped) were advanced → completed (a2 is last)
    expect(calls("status='completed'").map(([, p]) => p?.[0]).sort()).toEqual([3, 4, 5, 6]);
    expect(m.releaseWaSend).not.toHaveBeenCalled();
  });
  it('_sendWhatsAppGroup: failed broadcast releases cap and logs failed, still advances', async () => {
    route([
      ['SELECT nodes, edges FROM journey_flows', () => [FLOW]],
      ['FROM unified_contacts WHERE id = ANY', () => [{ id: '12', name: 'A', email: 'a@x', mobile: '971501234567', wa_unsubscribe: null }]],
    ]);
    m.broadcast.mockRejectedValue(new Error('chathead 502'));
    const node = FLOW.nodes[3] as ContinuousWaNode;
    const r = await ContinuousJourneyService._sendWhatsAppGroup({ node, waCh: '3', waTpl: '9', entries: [{ id: 3, journey_id: 7, unified_id: '12', item_id: '_noitem', current_node_id: 'a2', last_event_id: null }] });
    expect(r).toEqual({ broadcasts: 1, sent: 1, exited: 0 });
    expect(m.releaseWaSend).toHaveBeenCalledTimes(1);
    const wlog = calls('INSERT INTO whatsapp_send_log')[0][1] ?? [];
    expect(wlog[10]).toBe('failed');
    expect(wlog[11]).toBe('chathead 502');
    expect(calls("status='completed'")).toHaveLength(1);
  });
  it('_sendWhatsAppGroup: missing ChatHead config blocks without broadcasting', async () => {
    route([['FROM unified_contacts WHERE id = ANY', () => [{ id: '12', mobile: '971501234567' }]]]);
    const node = { id: 'a2', type: 'action', data: { channel: 'whatsapp' } };
    const r = await ContinuousJourneyService._sendWhatsAppGroup({ node, waCh: undefined, waTpl: undefined, entries: [{ id: 3, journey_id: 7, unified_id: '12', item_id: '_noitem', current_node_id: 'a2', last_event_id: null }] });
    expect(r.broadcasts).toBe(0);
    expect(m.broadcast).not.toHaveBeenCalled();
    expect(String(calls('INSERT INTO journey_events')[0][1]?.[3])).toContain('missing_chathead_config');
  });
});

describe('GtmJourneyService.processJob (email/WA/RCS node send)', () => {
  const contact = { id: 10, email: 'u@x.com', name: 'U', mobile: '971501234567', email_unsubscribe: null, wa_unsubscribe: null };
  function base(extra: Route[] = [], c: Record<string, unknown> = contact, flow: { nodes: unknown[]; edges: unknown[] } = FLOW, cred: string | null = null) {
    route([
      ...extra,
      ['FROM unified_contacts WHERE id = $1', () => [c]],
      ['FROM giveaway_events', () => []],
      ['FROM gtm_events WHERE event_id', () => []],
      ['SELECT nodes, edges, email_credential', () => [{ ...flow, email_credential: cred }]],
      ['SELECT nodes, edges FROM journey_flows', () => [flow]],
      ['FROM content_templates', () => [{ subject: 'Hi {{USER_NAME}}', body: '<html><body><a href="https://raynatours.com/x">x</a></body></html>', html_template_id: null }]],
      ['SELECT recommendation_type', () => [{ recommendation_type: null }]],
    ]);
  }
  it('no email → nothing sent', async () => {
    base([], { ...contact, email: null });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' });
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
  it('unsubscribed contact exits entry without sending', async () => {
    base([], { ...contact, email_unsubscribe: 'Yes' });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' });
    expect(calls("status='exited'")[0][1]).toEqual([1, 'unsubscribed']);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
  it('purchased item exits (conversion exit) without sending', async () => {
    base([["event_name = 'purchase'", () => [{ '?column?': 1 }]]]);
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1', itemId: 'P9' });
    expect(calls("status='exited'")[0][1]).toEqual([1, 'purchased']);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
  it('email success: logs, tracks, marks sent and advances to the WA node', async () => {
    base();
    m.sendEmail.mockResolvedValue({ success: true, provider: 'aws-email', externalId: 'X1' });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' });
    const arg = m.sendEmail.mock.calls[0][0];
    expect(arg).toMatchObject({ emailCredential: 'default', to: 'u@x.com' });
    expect(arg.html).toContain('101');
    expect(m.logSend.mock.calls[0][0]).toMatchObject({ source: 'gtm_journey', journeyId: 7, nodeId: 'a1' });
    expect(m.markSent.mock.calls[0][0]).toBe(101);
    expect(calls('SET current_node_id=$2')[0][1]?.[1]).toBe('a2');
  });
  it('email failure: releases cap, marks failed and throws for retry (no advance)', async () => {
    base([], contact, FLOW, 'giveaway');
    m.sendEmail.mockResolvedValue({ success: false, error: 'smtp 550' });
    await expect(GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' })).rejects.toThrow('smtp 550');
    expect(m.sendEmail.mock.calls[0][0].emailCredential).toBe('giveaway');
    expect(m.releaseSend).toHaveBeenCalledTimes(1);
    expect(m.markFailed).toHaveBeenCalledTimes(1);
    expect(calls('SET current_node_id=$2')).toHaveLength(0);
  });
  it('frequency cap: skip + advance, nothing logged', async () => {
    base();
    m.reserveSend.mockResolvedValue({ allowed: false, count: 3 });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' });
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.logSend).not.toHaveBeenCalled();
    expect(calls('SET current_node_id=$2')).toHaveLength(1);
  });
  it('allow-list miss: skip + advance', async () => {
    process.env.WELCOME_EMAILS = 'only@x.com';
    base();
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a1' });
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(calls('SET current_node_id=$2')).toHaveLength(1);
  });
  it('WhatsApp node: never falls through to email; sends broadcast and completes', async () => {
    base();
    m.broadcast.mockResolvedValue({ success: true, broadcast: { id: 2, chatheadBroadcastId: 88 } });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a2' });
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.broadcast.mock.calls[0][0].contacts[0].phone).toBe('971501234567');
    expect(calls('INSERT INTO whatsapp_send_log')[0][1]?.[10]).toBe('sent');
    expect(calls("status='completed'")).toHaveLength(1);
  });
  it('WhatsApp node: wa opt-out exits', async () => {
    base([], { ...contact, wa_unsubscribe: 'yes' });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'a2' });
    expect(calls("status='exited'")[0][1]).toEqual([1, 'wa_unsubscribed']);
    expect(m.broadcast).not.toHaveBeenCalled();
  });
  it('RCS node: sends via Gupshup and logs sms_send_log', async () => {
    const flow = { nodes: [{ id: 'r', type: 'action', data: { channel: 'rcs', rcsTemplateCode: 'T1' } }], edges: [] };
    base([], contact, flow);
    m.sendRCS.mockResolvedValue({ success: true, simulated: true });
    await GtmJourneyService.processJob({ entryId: 1, journeyId: 7, unifiedId: 10, nodeId: 'r' });
    expect(m.sendRCS.mock.calls[0][0]).toMatchObject({ to: '971501234567', templateCode: 'T1' });
    expect(calls('INSERT INTO sms_send_log')[0][1]?.[7]).toBe('simulated');
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});
