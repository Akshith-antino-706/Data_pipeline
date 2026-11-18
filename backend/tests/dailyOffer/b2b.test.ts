import { test, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import DailyOfferService, {
  type CreateResult, type FinalCheckResult, type OfferJourneyRow, type OfferServices, type Queryable, type SendCheckResult,
} from '../../src/services/dailyOffer/DailyOfferService.js';
import { getDailyOfferConfig, audienceOf, type DailyOfferAudience, type DailyOfferConfig } from '../../src/services/dailyOffer/config.js';
import { registerDailyOfferCrons, type OfferJobs } from '../../src/services/dailyOffer/cron.js';
import { buildTemplate } from '../../src/services/dailyOffer/render.js';
import { validateFeed } from '../../src/services/dailyOffer/feed.js';
import { alertHtml, type sendFailureAlert } from '../../src/services/dailyOffer/alert.js';
import type { DailyOfferLabel, FeedResult, OfferPick } from '../../src/services/dailyOffer/types.js';
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

/** A saved template / journey in the in-memory world. */
type TemplateRow = ContentTemplateInput & { id: number };
type JourneyRow = OfferJourneyRow & Partial<CreateJourneyInput>;
type Segment = { id: number; name: string; is_active: boolean };

/** pg-shaped result for the stand-in database. */
function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

const nodesOf = (j: JourneyRow): JourneyFlowNode[] => j.nodes || [];
const labelOf = (j: JourneyRow): DailyOfferLabel => nodesOf(j)[1].data?.dailyOffer as DailyOfferLabel;

/** In-memory stand-ins for the database and the two services (same shape as service.test.ts). */
function world({ journeys = [], fxAgeHours = 3, sentJourneys = [] }: {
  journeys?: JourneyRow[]; fxAgeHours?: number; sentJourneys?: number[];
} = {}) {
  const state = { journeys: [...journeys], templates: [] as TemplateRow[], nextJourney: 1000, nextTemplate: 500 };
  const segments: Record<number, Segment> = {
    86: { id: 86, name: 'B2C - Subscribed Users only', is_active: true },
    87: { id: 87, name: 'B2B - Subscribed Users Only', is_active: true },
  };
  const db: Queryable = {
    async query<R extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
      const rows = ((): unknown[] => {
        if (sql.includes('FROM journey_flows') && sql.includes('dailyOffer')) return [...state.journeys].sort((a, b) => b.journey_id - a.journey_id);
        if (sql.includes('FROM custom_segments')) { const s = segments[Number(params[0])]; return s ? [s] : []; }
        if (sql.includes('FROM fx_rates')) {
          const at = new Date(NINE_AM.getTime() - fxAgeHours * 3600000);
          return ([['INR', 25.95], ['SAR', 1.02], ['USD', 0.2723]] as const).map(([currency, r]) => ({ currency, aed_to_currency: r, updated_at: at }));
        }
        if (sql.includes('FROM content_templates')) return state.templates.filter(t => t.id === params[0]);
        if (sql.includes('FROM email_send_log')) return sentJourneys.includes(Number(params[0])) ? [{ '?column?': 1 }] : [];
        throw new Error(`unexpected query: ${sql}`);
      })();
      return result(rows as R[]);
    },
  };
  const services: OfferServices = {
    ContentService: {
      async create(t: ContentTemplateInput) { const row = { id: state.nextTemplate++, ...t }; state.templates.push(row); return row; },
      async update(id: number | string, f: ContentTemplateUpdate) { Object.assign(state.templates.find(t => t.id === id)!, f); },
      async delete(id: number | string) { state.templates = state.templates.filter(t => t.id !== id); },
    },
    JourneyService: {
      async create(j: CreateJourneyInput) {
        const row: JourneyRow = { journey_id: state.nextJourney++, status: 'draft', snapshot_count: 4, scheduled_start_at: null, ...j, nodes: j.nodes || [] };
        state.journeys.push(row); return row;
      },
      async update(id: number, f: Record<string, unknown>) { Object.assign(state.journeys.find(x => x.journey_id === id)!, f); },
    },
  };
  return { state, db, services };
}

type World = ReturnType<typeof world>;

const noAi: SuggestSubjectFn = async (pick) => ({ lead: pick.subjectLead, source: 'fallback', reason: 'no_api_key' });
const aiLead: SuggestSubjectFn = async () => ({ lead: 'Visas for your next trip, sorted ✈️', source: 'ai', reason: null });
const feedOf = (now: Date): FeedResult => validateFeed(fullFeed(now), { now });

function svc(w: World, audience: DailyOfferAudience, { feed = feedOf, env = {}, suggestSubject = noAi }: {
  feed?: (now: Date) => FeedResult; env?: NodeJS.ProcessEnv; suggestSubject?: SuggestSubjectFn;
} = {}) {
  return new DailyOfferService({
    db: w.db, services: w.services, log: silent, suggestSubject,
    config: getDailyOfferConfig({ ...ON_BOTH, ...env }, audience),
    fetchFeed: async ({ now }) => feed(now ?? new Date()),
  });
}
const b2cJourney = (w: World): JourneyRow => w.state.journeys.find(j => audienceOf(labelOf(j)) === 'b2c')!;
const b2bJourney = (w: World): JourneyRow => w.state.journeys.find(j => audienceOf(labelOf(j)) === 'b2b')!;
const templateOf = (w: World, j: JourneyRow): TemplateRow => w.state.templates.find(t => t.id === nodesOf(j)[1].data?.emailTemplateId)!;
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
const messageOf = (r: CreateResult | FinalCheckResult | SendCheckResult): string => ('message' in r ? r.message : '');

// ── Config ──

test('config: B2B profile is off by default and reads its own DAILY_OFFER_B2B_* values', () => {
  const off = getDailyOfferConfig({ DAILY_OFFER_ENABLED: 'true' }, 'b2b');
  expect(off.enabled).toBe(false);
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
  expect(b2c.links).toBe(null);
  expect(audienceOf({ date: '2026-11-07' } as { audience?: DailyOfferAudience })).toBe('b2c');   // rows saved before the B2B job
  expect(audienceOf({ audience: 'b2b' })).toBe('b2b');
});

// ── Render ──

test('render: with links every product card and the button open the B2B portal; without, the feed pages', () => {
  const feed = feedOf(NINE_AM);
  const products = feed.products.slice(0, 4);
  const pick = { loopDay: 4, theme: 'visa', themeName: 'Visa Offers', subjectLead: 'Visas', count: 4,
    groups: [{ title: 'Visas', subtitle: '', products }], productKeys: products.map(p => p.key) } as OfferPick;
  const b2b = buildTemplate(pick, getDailyOfferConfig(ON_BOTH, 'b2b').links);
  const b2c = buildTemplate(pick);
  for (const p of products) {
    expect(b2c.includes(`href="${p.url}"`), `B2C links to ${p.url}`).toBe(true);
    expect(!b2b.includes(p.url), `B2B must not link to ${p.url}`).toBe(true);
  }
  expect(hrefs(b2b).filter(h => h === PORTAL).length).toBe(products.length * 2 + 2);   // image + title per card, plus the button (Outlook VML + normal link)
  expect(b2b.includes('CLICK HERE FOR B2B RATES') || b2b.includes('Click Here For B2B Rates')).toBe(true);
  expect(b2c.includes('Explore All Visas')).toBe(true);
  // B2B drops the consumer promo blocks (giveaways, affiliate programme) like the hand-made B2B emails; B2C keeps them.
  for (const promo of ['raynatours.com/giveaways', 'affiliates.raynatours.com', 'Enter Now']) {
    expect(b2c.includes(promo), `B2C keeps ${promo}`).toBe(true);
    expect(!b2b.includes(promo), `B2B has no ${promo}`).toBe(true);
  }
  expect(b2b.includes('Privacy Policy') && b2b.includes('Verified by the platforms')).toBe(true);   // footer + trust badges stay
  // Same products, names and price tokens in both.
  for (const p of products) {
    expect(b2b.includes(`%%DO_PRICE:${p.key}%%`) && b2c.includes(`%%DO_PRICE:${p.key}%%`)).toBe(true);
    expect(b2b.includes(p.name) && b2c.includes(p.name)).toBe(true);
  }
});

// ── Create ──

test('create (B2B): waits while the B2C journey of the day does not exist yet — nothing saved', async () => {
  const w = world();
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect(res.status).toBe('skipped');
  expect(res.status === 'skipped' && res.reason).toBe('waiting_for_b2c');
  expect(w.state.journeys.length + w.state.templates.length).toBe(0);
});

test('create (B2B): copies the B2C day — same products, theme and subject; B2B segment, name and portal links', async () => {
  const w = world();
  await svc(w, 'b2c', { suggestSubject: aiLead }).runCreate({ now: NINE_AM });
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect(res.status, messageOf(res)).toBe('created');
  expect(res.status === 'created' && res.name).toBe('7th November - Visa Offers (Day 4) - B2B');
  const b2c = b2cJourney(w), b2b = b2bJourney(w);
  expect(b2b.segmentId).toBe('custom:87');
  expect(b2c.segmentId).toBe('custom:86');
  expect(b2b.scheduledStartAt).toBe(null);
  const lc = labelOf(b2c), lb = labelOf(b2b);
  expect(lb.productKeys).toEqual(lc.productKeys);
  expect(lb.products).toEqual(lc.products);                 // same names + per-market prices
  expect(lb.loopDay).toBe(4); expect(lb.theme).toBe('visa');
  expect(lb.audience).toBe('b2b'); expect(lb.mirrorOf).toBe(b2c.journey_id);
  expect(lc.audience).toBe(undefined);
  expect(templateOf(w, b2b).subject).toBe(templateOf(w, b2c).subject);   // AI subject carried over
  expect(lb.subject?.source).toBe('mirror');
  const html = templateOf(w, b2b).body ?? '';
  expect(!html.includes('raynatours.com/visas')).toBe(true);
  expect(html.includes(`href="${PORTAL}"`)).toBe(true);
  expect((templateOf(w, b2c).body ?? '').includes('https://www.raynatours.com/')).toBe(true);
});

test('create (B2B): runs again the same day → exists; a B2C re-run still sees only its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect((await svc(w, 'b2b').runCreate({ now: new Date(NINE_15.getTime() + 30 * 60000) })).status).toBe('exists');
  const again = await svc(w, 'b2c').runCreate({ now: new Date(NINE_AM.getTime() + 60 * 60000) });
  expect(again.status).toBe('exists');
  expect(again.status === 'exists' && again.journeyId).toBe(b2cJourney(w).journey_id);
  expect(w.state.journeys.length).toBe(2);
});

test('create (B2C): the B2B journeys never change the B2C product rotation', async () => {
  // A completed B2B cruise day with product keys that B2C has never sent.
  const b2bPast = { journey_id: 10, status: 'completed', scheduled_start_at: null, snapshot_count: 4,
    nodes: [{ id: 'node_0', data: {} }, { id: 'node_1', data: { emailTemplateId: 10,
      dailyOffer: { date: '2026-11-05', loopDay: 2, theme: 'cruise', status: 'scheduled', audience: 'b2b', productKeys: ['cruise-1', 'cruise-2'] } } }] } as unknown as JourneyRow;
  const w = world({ journeys: [b2bPast] });
  const plan = svc(w, 'b2c').planToday(await svc(w, 'b2c').recentJourneys(), '2026-11-09');   // cruise day
  expect(plan.previous.productKeys).toEqual([]);
});

test('create (B2B): skipped (not saved) when the segment is missing or the B2C day was marked not sent', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  const missing = await svc(w, 'b2b', { env: { DAILY_OFFER_B2B_SEGMENT_ID: '999' } }).runCreate({ now: NINE_15 });
  expect(missing.status === 'skipped' && missing.reason).toBe('segment_missing');
  labelOf(b2cJourney(w)).status = 'skipped';
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  expect(res.status === 'skipped' && res.reason).toBe('b2c_skipped');
  expect(w.state.journeys.length).toBe(1);
});

// ── Final check + send check ──

test('final check (B2B): passes → start time 12:00 Dubai; the B2C journey is left alone', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  const res = await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK });
  expect(res.status, messageOf(res)).toBe('scheduled');
  expect(b2bJourney(w).scheduled_start_at).toBe('2026-11-07T08:00:00.000Z');   // 12:00 Dubai
  expect(labelOf(b2bJourney(w)).audience).toBe('b2b');                          // label kept
  expect(b2cJourney(w).scheduled_start_at).toBe(null);
  expect((templateOf(w, b2bJourney(w)).body ?? '').includes(`href="${PORTAL}"`)).toBe(true);     // links survive the refresh
  // B2C's own check later schedules only B2C at 16:00.
  expect((await svc(w, 'b2c').runFinalCheck({ now: B2C_CHECK })).status).toBe('scheduled');
  expect(b2cJourney(w).scheduled_start_at).toBe('2026-11-07T12:00:00.000Z');
});

test('final check / send check (B2B): each audience only looks at its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  expect((await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK })).status).toBe('none');
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  w.state.journeys.find(j => audienceOf(labelOf(j)) === 'b2b')!.status = 'active';
  const at = new Date('2026-11-07T09:30:00Z');   // 13:30 Dubai
  const quiet = await svc(w, 'b2b').runSendCheck({ now: at });
  expect(quiet.status).toBe('not_sent');
  expect(quiet.status === 'not_sent' && quiet.journeyId).toBe(b2bJourney(w).journey_id);
  expect(messageOf(quiet)).toMatch(/send time 12:00/);
  const sentW = world({ journeys: w.state.journeys, sentJourneys: [b2bJourney(w).journey_id] });
  expect((await svc(sentW, 'b2b').runSendCheck({ now: at })).status).toBe('sent');
});

// ── Cron ──

type Job = () => Promise<void> | void;
type AlertCall = Parameters<typeof sendFailureAlert>[0];

const dubai = (date: string, hhmm: string): Date => new Date(`${date}T${hhmm}:00+04:00`);
function crons(env: NodeJS.ProcessEnv) {
  const jobs = new Map<string, Job>(); const calls: string[] = []; const alerts: AlertCall[] = []; let clock = dubai('2026-11-07', '09:00');
  const makeService = (config: DailyOfferConfig): OfferJobs => ({
    async runCreate() { calls.push(`${config.audience}:create`); return { status: 'skipped', reason: 'feed_not_today', message: 'x' }; },
    async runFinalCheck() { calls.push(`${config.audience}:final`); return { status: 'scheduled', journeyId: 1, count: 10, dropped: [] }; },
    async runSendCheck() { calls.push(`${config.audience}:send`); return { status: 'sent', journeyId: 1 }; },
  });
  const on = registerDailyOfferCrons({ schedule: ((expr: string, fn: Job) => { jobs.set(expr, fn); }) as never },
    { env, log: silent, makeService, sendAlert: async (a) => { alerts.push(a); return 1; }, now: () => clock });
  const run = async (expr: string, hhmm: string) => {
    clock = dubai('2026-11-07', hhmm);
    const job = jobs.get(expr);
    if (!job) throw new Error(`no job scheduled at "${expr}"`);
    await job();
  };
  return { on, jobs, calls, alerts, run };
}

test('cron: B2B off → exactly the three B2C jobs as before', () => {
  const s = crons({ DAILY_OFFER_ENABLED: 'true' });
  expect([...s.jobs.keys()]).toEqual(['*/30 * * * *', '45 15 * * *', '30 17 * * *']);
});

test('cron: B2B on → its own create (:15/:45 from 09:15 to 11:15), final check 11:45 and send check 13:30', async () => {
  const s = crons(ON_BOTH);
  expect(s.on).toBe(true);
  expect([...s.jobs.keys()]).toEqual(['*/30 * * * *', '45 15 * * *', '30 17 * * *', '15,45 * * * *', '45 11 * * *', '30 13 * * *']);
  await s.run('15,45 * * * *', '09:14');   // before the window
  await s.run('15,45 * * * *', '11:16');   // after it
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
  expect(html.includes('Daily offer email (B2B) not sent')).toBe(true);
  expect(html.includes('B2B · Segment 87')).toBe(true);
  expect(!alertHtml({ date: '2026-11-07', stage: 'create', reason: 'x', message: 'y', segmentId: 86 }).includes('(B2B)')).toBe(true);
});

test('cron: B2B can run alone (B2C off) — only its jobs are registered', () => {
  const s = crons({ DAILY_OFFER_B2B_ENABLED: 'true' });
  expect([...s.jobs.keys()]).toEqual(['15,45 * * * *', '45 11 * * *', '30 13 * * *']);
});
