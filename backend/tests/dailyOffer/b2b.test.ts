import { test, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import DailyOfferService, { type OfferJourneyRow, type OfferServices, type Queryable } from '../../src/services/dailyOffer/DailyOfferService.js';
import { getDailyOfferConfig, audienceOf } from '../../src/services/dailyOffer/config.js';
import { registerDailyOfferCrons, type OfferJobs } from '../../src/services/dailyOffer/cron.js';
import { buildTemplate } from '../../src/services/dailyOffer/render.js';
import { validateFeed } from '../../src/services/dailyOffer/feed.js';
import { alertHtml, type sendFailureAlert } from '../../src/services/dailyOffer/alert.js';
import type { DailyOfferLabel, FeedResult, OfferAudience, OfferPick } from '../../src/services/dailyOffer/types.js';
import type { SuggestSubjectFn } from '../../src/services/dailyOffer/aiSubject.js';
import type { ContentTemplateInput, ContentTemplateUpdate } from '../../src/types/services_A.js';
import type { CreateJourneyInput, JourneyFlowNode } from '../../src/types/journeyService.js';
import { fullFeed } from './fixtures.js';

// Everything here is a stand-in: no database, no Claude, no email is sent.
const silent = { log() {}, warn() {}, error() {} };
const NINE_AM   = new Date('2026-11-07T05:00:00Z');   // 09:00 Dubai — loop Day 4, Visa
const NINE_15   = new Date('2026-11-07T05:15:00Z');   // 09:15 Dubai — first B2B attempt
const B2B_CHECK = new Date('2026-11-07T07:45:00Z');   // 11:45 Dubai
const B2C_CHECK = new Date('2026-11-07T11:45:00Z');   // 15:45 Dubai
const PORTAL = 'https://www.raynab2b.com';
const ON_BOTH = { DAILY_OFFER_ENABLED: 'true', DAILY_OFFER_B2B_ENABLED: 'true', DAILY_OFFER_SEGMENT_ID: '86', DAILY_OFFER_B2B_SEGMENT_ID: '87' };

type TemplateRow = ContentTemplateInput & { id: number };
type JourneyRow = OfferJourneyRow & Partial<CreateJourneyInput> & { description?: string | null };
function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}
const nodesOf = (j: JourneyRow): JourneyFlowNode[] => j.nodes || [];
const labelOf = (j: JourneyRow): DailyOfferLabel => nodesOf(j)[1].data?.dailyOffer as DailyOfferLabel;

/** In-memory stand-ins (same shape as service.test.ts) with both segments present. */
function world({ journeys = [], fxAgeHours = 3, sentJourneys = [] }: { journeys?: JourneyRow[]; fxAgeHours?: number; sentJourneys?: number[] } = {}) {
  const state = { journeys: [...journeys], templates: [] as TemplateRow[], nextJourney: 1000, nextTemplate: 500 };
  const segments: Record<number, { id: number; name: string; is_active: boolean }> = {
    86: { id: 86, name: 'B2C - Subscribed Users only', is_active: true },
    87: { id: 87, name: 'B2B - Subscribed Users Only', is_active: true },
  };
  const db: Queryable = {
    async query<R extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
      const rows = ((): unknown[] => {
        if (sql.includes('FROM journey_flows') && sql.includes('dailyOffer')) return [...state.journeys].sort((a, b) => b.journey_id - a.journey_id);
        if (sql.includes('FROM custom_segments')) { const seg = segments[Number(params[0])]; return seg ? [seg] : []; }
        if (sql.includes('FROM fx_rates')) {
          const at = new Date(NINE_AM.getTime() - fxAgeHours * 3600000);
          return ([['INR', 25.95], ['SAR', 1.02], ['USD', 0.2723]] as const).map(([currency, r]) => ({ currency, aed_to_currency: r, updated_at: at }));
        }
        if (sql.includes('FROM content_templates')) return state.templates.filter(t => t.id === params[0]);
        if (sql.includes('FROM email_send_log')) return sentJourneys.includes(Number(params[0])) ? [{ sent: 1 }] : [];
        throw new Error(`unexpected query: ${sql}`);
      })();
      return result(rows as R[]);
    },
  };
  const services: OfferServices = {
    ContentService: {
      async create(t: ContentTemplateInput) { const row = { id: state.nextTemplate++, ...t }; state.templates.push(row); return row; },
      async update(id: number | string, f: ContentTemplateUpdate) { const t = state.templates.find(x => x.id === id); if (t) Object.assign(t, f); },
      async delete(id: number | string) { state.templates = state.templates.filter(t => t.id !== id); },
    },
    JourneyService: {
      async create(j: CreateJourneyInput) {
        const row: JourneyRow = { journey_id: state.nextJourney++, status: 'draft', snapshot_count: 4, scheduled_start_at: null, ...j, nodes: j.nodes || [] };
        state.journeys.push(row); return row;
      },
      async update(id: number, f: Record<string, unknown>) { const j = state.journeys.find(x => x.journey_id === id); if (j) Object.assign(j, f); },
    },
  };
  return { state, db, services };
}
type World = ReturnType<typeof world>;

const noAi: SuggestSubjectFn = async (pick) => ({ lead: pick.subjectLead, source: 'fallback', reason: 'no_api_key' });
const aiLead: SuggestSubjectFn = async () => ({ lead: 'Visas for your next trip, sorted ✈️', source: 'ai', reason: null });
const feedOf = (now: Date): FeedResult => validateFeed(fullFeed(now), { now });

function svc(w: World, audience: OfferAudience, { feed = feedOf, env = {}, suggestSubject = noAi }: {
  feed?: (now: Date) => FeedResult; env?: NodeJS.ProcessEnv; suggestSubject?: SuggestSubjectFn;
} = {}) {
  return new DailyOfferService({
    db: w.db, services: w.services, log: silent, suggestSubject,
    config: getDailyOfferConfig({ ...ON_BOTH, ...env }, audience),
    fetchFeed: async ({ now }) => feed(now ?? new Date()),
  });
}
const b2cJourney = (w: World): JourneyRow => w.state.journeys.find(j => audienceOf(labelOf(j)) === 'b2c') as JourneyRow;
const b2bJourney = (w: World): JourneyRow => w.state.journeys.find(j => audienceOf(labelOf(j)) === 'b2b') as JourneyRow;
const templateOf = (w: World, j: JourneyRow): TemplateRow => w.state.templates.find(t => t.id === nodesOf(j)[1].data?.emailTemplateId) as TemplateRow;
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

// ── Config ──

test('config: B2B profile is off by default and reads its own DAILY_OFFER_B2B_* values', () => {
  expect(getDailyOfferConfig({ DAILY_OFFER_ENABLED: 'true' }, 'b2b').enabled).toBe(false);
  expect(getDailyOfferConfig({ DAILY_OFFER_B2B_ENABLED: 'true' }, 'b2b').segmentId).toBe(87);   // real B2B segment by default; DAILY_OFFER_B2B_SEGMENT_ID=95 for trial inboxes
  const on = getDailyOfferConfig(ON_BOTH, 'b2b');
  expect(on.enabled).toBe(true);
  expect(on.audience).toBe('b2b');
  expect(on.segmentId).toBe(87);
  expect([on.createAt, on.retryUntil, on.checkAt, on.sendAt, on.sendCheckAt]).toEqual(['09:15', '11:15', '11:45', '12:00', '13:30']);
  expect(on.links).toEqual({ productUrl: PORTAL, ctaUrl: PORTAL, ctaLabel: 'Click Here For B2B Rates' });
  // B2C is untouched by the B2B variables.
  const b2c = getDailyOfferConfig(ON_BOTH, 'b2c');
  expect(b2c.audience).toBe('b2c');
  expect(b2c.segmentId).toBe(86);
  expect(b2c.sendAt).toBe('16:00');
  expect(b2c.links).toBeNull();
  expect(audienceOf({})).toBe('b2c');   // rows saved before the B2B job
  expect(audienceOf({ audience: 'b2b' })).toBe('b2b');
});

// ── Render ──

test('render: with links every card and the button open the B2B portal and the consumer promos are dropped', () => {
  const feed = feedOf(NINE_AM);
  const products = feed.products.slice(0, 4);
  const pick: OfferPick = { loopDay: 4, theme: 'visa', themeName: 'Visa Offers', subjectLead: 'Visas', count: 4,
    groups: [{ title: 'Visas', subtitle: '', products }], productKeys: products.map(p => p.key) };
  const b2b = buildTemplate(pick, getDailyOfferConfig(ON_BOTH, 'b2b').links);
  const b2c = buildTemplate(pick);
  for (const p of products) {
    expect(b2c).toContain(`href="${p.url}"`);
    expect(b2b).not.toContain(p.url);
    expect(b2b).toContain(`%%DO_PRICE:${p.key}%%`);
    expect(b2b).toContain(p.name);
  }
  expect(hrefs(b2b).filter(h => h === PORTAL)).toHaveLength(products.length * 2 + 2);   // image + title per card, button (Outlook VML + link)
  expect(b2b).toContain('Click Here For B2B Rates');
  expect(b2c).toContain('Explore All Visas');
  for (const promo of ['raynatours.com/giveaways', 'affiliates.raynatours.com', 'Enter Now']) {
    expect(b2c).toContain(promo);
    expect(b2b).not.toContain(promo);
  }
  expect(b2b).toContain('Privacy Policy');
  expect(b2b).toContain('Verified by the platforms');
});

// ── Create ──

test('create (B2B): waits while the B2C journey of the day does not exist yet — nothing saved', async () => {
  const w = world();
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect(res).toMatchObject({ status: 'skipped', reason: 'waiting_for_b2c' });
  expect(w.state.journeys.length + w.state.templates.length).toBe(0);
});

test('create (B2B): copies the B2C day — same products, theme and subject; B2B segment, name and portal links', async () => {
  const w = world();
  await svc(w, 'b2c', { suggestSubject: aiLead }).runCreate({ now: NINE_AM });
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect(res.status).toBe('created');
  expect(res).toMatchObject({ name: '7th November - Visa Offers (Day 4) - B2B' });
  const b2c = b2cJourney(w), b2b = b2bJourney(w);
  expect(b2b.segmentId).toBe('custom:87');
  expect(b2c.segmentId).toBe('custom:86');
  expect(b2b.scheduledStartAt).toBeNull();
  const lc = labelOf(b2c), lb = labelOf(b2b);
  expect(lb.productKeys).toEqual(lc.productKeys);
  expect(lb.products).toEqual(lc.products);
  expect(lb.loopDay).toBe(4); expect(lb.theme).toBe('visa');
  expect(lb.audience).toBe('b2b'); expect(lb.mirrorOf).toBe(b2c.journey_id);
  expect(lc.audience).toBeUndefined();
  expect(templateOf(w, b2b).subject).toBe(templateOf(w, b2c).subject);
  expect(lb.subject?.source).toBe('mirror');
  const html = String(templateOf(w, b2b).body);
  expect(html).not.toContain('raynatours.com/visas');
  expect(html).toContain(`href="${PORTAL}"`);
  expect(String(templateOf(w, b2c).body)).toContain('https://www.raynatours.com/');
});

test('create (B2B): runs again the same day → exists; a B2C re-run still sees only its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect((await svc(w, 'b2b').runCreate({ now: new Date(NINE_15.getTime() + 30 * 60000) })).status).toBe('exists');
  const again = await svc(w, 'b2c').runCreate({ now: new Date(NINE_AM.getTime() + 60 * 60000) });
  expect(again).toMatchObject({ status: 'exists', journeyId: b2cJourney(w).journey_id });
  expect(w.state.journeys).toHaveLength(2);
});

test('create (B2C): the B2B journeys never change the B2C product rotation', async () => {
  const label: DailyOfferLabel = { version: 1, date: '2026-11-05', loopDay: 2, theme: 'cruise', themeName: 'Cruises', status: 'scheduled',
    audience: 'b2b', productKeys: ['cruise-1', 'cruise-2'], activityCursor: null, groups: [], products: [], createdAt: '2026-11-05T05:00:00Z' };
  const b2bPast: JourneyRow = { journey_id: 10, status: 'completed', scheduled_start_at: null, snapshot_count: 4,
    nodes: [{ id: 'node_0', type: 'trigger', data: {} }, { id: 'node_1', type: 'action', data: { emailTemplateId: 10, dailyOffer: label } }] as JourneyFlowNode[] };
  const w = world({ journeys: [b2bPast] });
  const s = svc(w, 'b2c');
  const plan = s.planToday(await s.recentJourneys(), '2026-11-09');   // cruise day
  expect(plan.previous.productKeys).toEqual([]);
});

test('create (B2B): skipped (not saved) when the segment is missing or the B2C day was marked not sent', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  expect(await svc(w, 'b2b', { env: { DAILY_OFFER_B2B_SEGMENT_ID: '999' } }).runCreate({ now: NINE_15 })).toMatchObject({ status: 'skipped', reason: 'segment_missing' });
  labelOf(b2cJourney(w)).status = 'skipped';
  expect(await svc(w, 'b2b').runCreate({ now: NINE_15 })).toMatchObject({ status: 'skipped', reason: 'b2c_skipped' });
  expect(w.state.journeys).toHaveLength(1);
});

// ── Final check + send check ──

test('final check (B2B): passes → start time 12:00 Dubai; the B2C journey is left alone', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  const res = await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK });
  expect(res.status).toBe('scheduled');
  expect(b2bJourney(w).scheduled_start_at).toBe('2026-11-07T08:00:00.000Z');   // 12:00 Dubai
  expect(labelOf(b2bJourney(w)).audience).toBe('b2b');                            // label kept
  expect(b2cJourney(w).scheduled_start_at).toBeNull();
  expect(String(templateOf(w, b2bJourney(w)).body)).toContain(`href="${PORTAL}"`);   // links survive the refresh
  expect((await svc(w, 'b2c').runFinalCheck({ now: B2C_CHECK })).status).toBe('scheduled');
  expect(b2cJourney(w).scheduled_start_at).toBe('2026-11-07T12:00:00.000Z');
});

test('final check / send check (B2B): each audience only looks at its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  expect((await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK })).status).toBe('none');
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  b2bJourney(w).status = 'active';
  const at = new Date('2026-11-07T09:30:00Z');   // 13:30 Dubai
  const quiet = await svc(w, 'b2b').runSendCheck({ now: at });
  expect(quiet).toMatchObject({ status: 'not_sent', journeyId: b2bJourney(w).journey_id });
  expect(quiet.status === 'not_sent' ? quiet.message : '').toMatch(/send time 12:00/);
  const sentW = world({ journeys: w.state.journeys, sentJourneys: [b2bJourney(w).journey_id] });
  expect((await svc(sentW, 'b2b').runSendCheck({ now: at })).status).toBe('sent');
});

// ── Cron ──

type AlertCall = Parameters<typeof sendFailureAlert>[0];
const dubai = (date: string, hhmm: string): Date => new Date(`${date}T${hhmm}:00+04:00`);
function crons(env: NodeJS.ProcessEnv) {
  const jobs = new Map<string, () => Promise<void> | void>(); const calls: string[] = []; const alerts: AlertCall[] = [];
  let clock = dubai('2026-11-07', '09:00');
  const makeService = (config: { audience: OfferAudience }): OfferJobs => ({
    async runCreate() { calls.push(`${config.audience}:create`); return { status: 'skipped', reason: 'feed_not_today', message: 'x' }; },
    async runFinalCheck() { calls.push(`${config.audience}:final`); return { status: 'scheduled', journeyId: 1, count: 10, dropped: [] }; },
    async runSendCheck() { calls.push(`${config.audience}:send`); return { status: 'sent', journeyId: 1 }; },
  });
  const on = registerDailyOfferCrons({ schedule: ((expr: string, fn: () => Promise<void> | void) => { jobs.set(expr, fn); }) as never },
    { env, log: silent, makeService, sendAlert: async (a) => { alerts.push(a); return 1; }, now: () => clock });
  const run = async (expr: string, hhmm: string) => { clock = dubai('2026-11-07', hhmm); const job = jobs.get(expr); if (!job) throw new Error(`no job at ${expr}`); await job(); };
  return { on, jobs, calls, alerts, run };
}

test('cron: B2B off → exactly the three B2C jobs as before', () => {
  expect([...crons({ DAILY_OFFER_ENABLED: 'true' }).jobs.keys()]).toEqual(['*/30 * * * *', '45 15 * * *', '30 17 * * *']);
});

test('cron: B2B on → its own create (:15/:45 from 09:15 to 11:15), final check 11:45 and send check 13:30', async () => {
  const s = crons(ON_BOTH);
  expect(s.on).toBe(true);
  expect([...s.jobs.keys()]).toEqual(['*/30 * * * *', '45 15 * * *', '30 17 * * *', '15,45 * * * *', '45 11 * * *', '30 13 * * *']);
  await s.run('15,45 * * * *', '09:14');
  await s.run('15,45 * * * *', '11:16');
  expect(s.calls).toEqual([]);
  await s.run('15,45 * * * *', '09:15');
  await s.run('45 11 * * *', '11:45');
  await s.run('30 13 * * *', '13:30');
  expect(s.calls).toEqual(['b2b:create', 'b2b:final', 'b2b:send']);
});

test('cron: B2B alerts are separate from B2C and say so', async () => {
  const s = crons(ON_BOTH);
  await s.run('15,45 * * * *', '11:15');   // last B2B attempt failed → B2B alert
  await s.run('*/30 * * * *', '14:00');    // last B2C attempt failed → B2C alert, same day
  expect(s.alerts.map(a => [a.audience, a.segmentId, a.stage])).toEqual([['b2b', 87, 'create'], ['b2c', 86, 'create']]);
  const html = alertHtml({ date: '2026-11-07', stage: 'create', reason: 'x', message: 'y', segmentId: 87, audience: 'b2b' });
  expect(html).toContain('Daily offer email (B2B) not sent');
  expect(html).toContain('B2B · Segment 87');
  expect(alertHtml({ date: '2026-11-07', stage: 'create', reason: 'x', message: 'y', segmentId: 86 })).not.toContain('(B2B)');
});

test('cron: B2B can run alone (B2C off) — only its jobs are registered', () => {
  expect([...crons({ DAILY_OFFER_B2B_ENABLED: 'true' }).jobs.keys()]).toEqual(['15,45 * * * *', '45 11 * * *', '30 13 * * *']);
});
