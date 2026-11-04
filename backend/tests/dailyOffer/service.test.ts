import { test, expect } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import DailyOfferService, {
  ordinalDate, type OfferJourneyRow, type OfferServices, type Queryable,
} from '../../src/services/dailyOffer/DailyOfferService.js';
import { getDailyOfferConfig } from '../../src/services/dailyOffer/config.js';
import { validateFeed, FeedError } from '../../src/services/dailyOffer/feed.js';
import type { DailyOfferLabel, FeedResult, OfferTheme } from '../../src/services/dailyOffer/types.js';
import type { SuggestSubjectFn } from '../../src/services/dailyOffer/aiSubject.js';
import type { ContentTemplateInput, ContentTemplateUpdate } from '../../src/types/services_A.js';
import type { CreateJourneyInput, JourneyFlowNode } from '../../src/types/journeyService.js';
import { fullFeed } from './fixtures.js';

const NINE_AM = new Date('2026-11-07T05:00:00Z');        // 09:00 Dubai — loop Day 4, Visa
const CHECK = new Date('2026-11-07T11:45:00Z');          // 15:45 Dubai
const silent = { log() {}, warn() {}, error() {} };

/** A saved template / journey in the in-memory world. */
type TemplateRow = ContentTemplateInput & { id: number };
type JourneyRow = OfferJourneyRow & Partial<CreateJourneyInput> & { description?: string | null };

/** pg-shaped result for the stand-in database. */
function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

const nodesOf = (j: JourneyRow): JourneyFlowNode[] => j.nodes || [];
const labelOf = (j: JourneyRow): DailyOfferLabel => nodesOf(j)[1].data?.dailyOffer as DailyOfferLabel;

/** In-memory stand-ins for the database and the two services the job uses. */
function world({ journeys = [], segment = { id: 95, name: 'B2C Testing Email Users', is_active: true }, fxAgeHours = 3, sentJourneys = [] }: {
  journeys?: JourneyRow[]; segment?: { id: number; name: string; is_active: boolean } | null; fxAgeHours?: number; sentJourneys?: number[];
} = {}) {
  const state = { journeys: [...journeys], templates: [] as TemplateRow[], nextJourney: 1000, nextTemplate: 500 };
  const db: Queryable = {
    async query<R extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
      const rows = ((): unknown[] => {
        if (sql.includes('FROM journey_flows') && sql.includes('dailyOffer')) {
          return [...state.journeys].sort((a, b) => b.journey_id - a.journey_id);
        }
        if (sql.includes('FROM journey_flows') && sql.includes('nodes @> $1')) {
          const tid = (JSON.parse(String(params[0])) as Array<{ data: { emailTemplateId: number } }>)[0].data.emailTemplateId;
          return state.journeys.filter(j => nodesOf(j).some(n => n.data?.emailTemplateId === tid));
        }
        if (sql.includes('FROM custom_segments')) return segment ? [segment] : [];
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
      async update(id: number | string, f: ContentTemplateUpdate) {
        const t = state.templates.find(x => x.id === id);
        if (t) Object.assign(t, f);
      },
      async delete(id: number | string) { state.templates = state.templates.filter(t => t.id !== id); },
    },
    JourneyService: {
      async create(j: CreateJourneyInput) {
        const row: JourneyRow = { journey_id: state.nextJourney++, status: 'draft', snapshot_count: 4, scheduled_start_at: null, ...j, nodes: j.nodes || [] };
        state.journeys.push(row); return row;
      },
      async update(id: number, f: Record<string, unknown>) {
        const j = state.journeys.find(x => x.journey_id === id);
        if (j) Object.assign(j, f);
      },
    },
  };
  return { state, db, services };
}

type World = ReturnType<typeof world>;

// Default AI stand-in: behaves like "no API key" so tests never call Claude.
const noAi: SuggestSubjectFn = async (pick) => ({ lead: pick.subjectLead, source: 'fallback', reason: 'no_api_key' });

function svc(w: World, { feed = (now: Date): FeedResult => validateFeed(fullFeed(now), { now }), env = {}, suggestSubject = noAi }: {
  feed?: (now: Date) => FeedResult; env?: NodeJS.ProcessEnv; suggestSubject?: SuggestSubjectFn;
} = {}) {
  return new DailyOfferService({
    db: w.db, services: w.services, log: silent, suggestSubject,
    config: getDailyOfferConfig({ DAILY_OFFER_ENABLED: 'true', ...env }),
    fetchFeed: async ({ now }) => feed(now ?? new Date()),
  });
}

/** A past daily-offer journey with the given loop day / status. */
function past(id: number, date: string, loopDay: number, theme: OfferTheme, status = 'completed', extra: Partial<DailyOfferLabel> = {}): JourneyRow {
  const label: DailyOfferLabel = {
    version: 1, date, loopDay, theme, themeName: theme, productKeys: [], status: 'scheduled',
    activityCursor: null, groups: [], products: [], createdAt: `${date}T05:00:00Z`, ...extra,
  };
  return { journey_id: id, status, scheduled_start_at: null, snapshot_count: 4,
    nodes: [{ id: 'node_0', data: {} }, { id: 'node_1', data: { emailTemplateId: id, dailyOffer: label } }] };
}

test('names: ordinal dates', () => {
  expect(ordinalDate('2026-11-01')).toBe('1st November');
  expect(ordinalDate('2026-11-02')).toBe('2nd November');
  expect(ordinalDate('2026-11-11')).toBe('11th November');
  expect(ordinalDate('2026-11-23')).toBe('23rd November');
});

test('create: first run makes the date\'s theme (7 Nov → Day 4, Visa) template + Draft journey with no start time', async () => {
  const w = world();
  const res = await svc(w).runCreate({ now: NINE_AM });
  expect(res.status).toBe('created');
  if (res.status !== 'created') return;
  expect(res.name).toBe('7th November - Visa Offers (Day 4)');
  const j = w.state.journeys[0];
  expect(j.segmentId).toBe('custom:95');
  expect(j.scheduledStartAt).toBe(null);
  expect(j.journeyType).toBe('fixed');
  const node = nodesOf(j)[1];
  expect(node.data?.emailTemplateId).toBe(w.state.templates[0].id);
  expect(labelOf(j).loopDay).toBe(4);
  expect(labelOf(j).products.length).toBe(10);
  expect(w.state.templates[0].body?.startsWith('<!--DAILY_OFFER-->')).toBe(true);
  expect(w.state.templates[0].createdBy).toBe('daily-offer-automation');
});

test('create: runs again the same day → nothing new (no duplicate, no download)', async () => {
  const w = world();
  let downloads = 0;
  const s = svc(w, { feed: (now) => { downloads += 1; return validateFeed(fullFeed(now), { now }); } });
  await s.runCreate({ now: NINE_AM });
  const again = await s.runCreate({ now: new Date(NINE_AM.getTime() + 30 * 60000) });
  expect(again.status).toBe('exists');
  expect(w.state.journeys.length).toBe(1);
  expect(downloads).toBe(1);
});

test('create: the date decides the theme, whatever sent before (5 Nov → Cruises)', async () => {
  const w = world({ journeys: [past(10, '2026-11-04', 5, 'cruise')] });
  const res = await svc(w).runCreate({ now: new Date('2026-11-05T05:00:00Z') });
  expect(res.status === 'created' && res.name).toMatch(/^5th November - Cruises \(Day 2\)$/);
});

test('create: a skipped day does not shift the calendar (Draft journey does not count)', async () => {
  const w = world({ journeys: [
    past(10, '2026-11-05', 2, 'cruise'),
    past(11, '2026-11-06', 3, 'activities', 'draft', { status: 'skipped' }),
  ] });
  const res = await svc(w).runCreate({ now: NINE_AM });
  expect(res.status === 'created' && res.name).toMatch(/Visa Offers \(Day 4\)$/);
});

test('create: cruise skips the cruises sent in the last cruise email', async () => {
  const first = world();
  await svc(first).runCreate({ now: new Date('2026-11-05T05:00:00Z') });
  const sentKeys = labelOf(first.state.journeys[0]).productKeys;
  // Rates dated 3 hours before 9 Nov 09:00 Dubai, so they are fresh for that run.
  const w = world({ journeys: [past(10, '2026-11-05', 2, 'cruise', 'completed', { productKeys: sentKeys })], fxAgeHours: 3 - 48 });
  const res = await svc(w).runCreate({ now: new Date('2026-11-09T05:00:00Z') });
  expect(res.status === 'created' && res.name).toMatch(/^9th November - Cruises \(Day 6\)$/);
  const next = labelOf(w.state.journeys[w.state.journeys.length - 1]).productKeys;
  expect(next.filter(k => sentKeys.includes(k)).length).toBe(0);
});

test('create: skipped (nothing saved) when the feed is not today', async () => {
  const w = world();
  const stale = (now: Date) => { const b = fullFeed(now); b.generatedAt = '2026-10-30T01:00:00Z'; return validateFeed(b, { now }); };
  const res = await svc(w, { feed: stale }).runCreate({ now: NINE_AM });
  expect(res.status).toBe('skipped');
  expect(res.status === 'skipped' && res.reason).toBe('feed_not_today');
  expect(w.state.journeys.length + w.state.templates.length).toBe(0);
});

test('create: skipped when there are fewer than the minimum products', async () => {
  const w = world();
  const res = await svc(w, { env: { DAILY_OFFER_MIN_PRODUCTS: '11' } }).runCreate({ now: NINE_AM });   // visa day has 10
  expect(res.status === 'skipped' && res.reason).toBe('too_few_products');
  expect(w.state.templates.length).toBe(0);
});

test('create: skipped when exchange rates are stale or the segment is missing', async () => {
  const reason = async (w: World) => { const r = await svc(w).runCreate({ now: NINE_AM }); return r.status === 'skipped' ? r.reason : r.status; };
  expect(await reason(world({ fxAgeHours: 60 }))).toBe('fx_stale');
  expect(await reason(world({ segment: null }))).toBe('segment_missing');
  expect(await reason(world({ segment: { id: 95, name: 'x', is_active: false } }))).toBe('segment_inactive');
});

test('final check: passes → start time set to 4 PM Dubai, prices refreshed', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const res = await s.runFinalCheck({ now: CHECK });
  expect(res.status, 'message' in res ? res.message : '').toBe('scheduled');
  const j = w.state.journeys[0];
  expect(j.scheduled_start_at).toBe('2026-11-07T12:00:00.000Z');   // 16:00 Dubai
  expect(labelOf(j).status).toBe('scheduled');
  // Runs again → no change.
  expect((await s.runFinalCheck({ now: CHECK })).status).toBe('already_scheduled');
});

test('final check: products that became unavailable are dropped', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  const usOff = (now: Date) => {
    const b = fullFeed(now);
    const us = b.products.find(p => String(p.url).endsWith('/usa-visa'));
    if (us) us.price_availabilityStatus = 'unavailable';
    return validateFeed(b, { now });
  };
  const res = await svc(w, { feed: usOff }).runFinalCheck({ now: CHECK });
  expect(res.status).toBe('scheduled');
  if (res.status !== 'scheduled') return;
  expect(res.count).toBe(9);
  expect(res.dropped.length).toBe(1);
  expect(w.state.templates[0].body).not.toContain('/usa-visa');
});

test('final check: fails → no start time, reason written into the description', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  w.state.journeys[0].snapshot_count = -2;
  const res = await svc(w).runFinalCheck({ now: CHECK });
  expect(res.status).toBe('skipped');
  expect(res.status === 'skipped' && res.reason).toBe('audience_failed');
  const j = w.state.journeys[0];
  expect(j.scheduled_start_at).toBe(null);
  expect(j.description).toMatch(/^Not sent: Audience list failed to build/);
  expect((await svc(w).runFinalCheck({ now: CHECK })).status).toBe('skipped_earlier');
});

test('final check: feed broken at 3:45 → not sent', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  const broken = (): FeedResult => { throw new FeedError('feed_http_error', 'Feed returned HTTP 503'); };
  const res = await svc(w, { feed: broken }).runFinalCheck({ now: CHECK });
  expect(res.status).toBe('skipped');
  expect(w.state.journeys[0].scheduled_start_at).toBe(null);
});

test('preview: View as India / UAE renders real prices for the saved template', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const tpl = { ...w.state.templates[0] };
  const india = await s.previewTemplate(tpl, 'india');
  const uae = await s.previewTemplate(tpl, 'uae');
  expect(india?.currency).toBe('INR');
  expect(india?.subject).toMatch(/from ₹/);
  expect(uae?.subject).toMatch(/from AED /);
  expect(india?.html).not.toContain('%%DO_');
  expect(india?.markets?.map(m => m.key)).toEqual(['india', 'uae', 'saudi', 'other', 'none']);
  expect(await s.previewTemplate({ id: 1, body: '<html>other template</html>' }, 'india')).toBe(null);
});

/** V8's gc() — present only when node runs with --expose-gc. */
const gc = (globalThis as { gc?: () => void }).gc;

test.skipIf(!gc)('memory: repeated runs do not grow the heap', async () => {
  const run = async () => { const w = world(); const s = svc(w); await s.runCreate({ now: NINE_AM }); await s.runFinalCheck({ now: CHECK }); };
  for (let i = 0; i < 5; i++) await run();
  gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 40; i++) await run();
  gc?.();
  const grown = (process.memoryUsage().heapUsed - before) / 1048576;
  expect(grown, `heap grew ${grown.toFixed(1)} MB over 40 runs`).toBeLessThan(5);
});

test('create: if saving the journey fails, the template it just saved is removed', async () => {
  const w = world();
  w.services.JourneyService.create = async () => { throw new Error('db down'); };
  const res = await svc(w).runCreate({ now: NINE_AM });
  expect(res.status).toBe('skipped');
  expect(w.state.templates.length).toBe(0);
});

test('preview: a daily template whose journey is gone shows a clear message, never raw tokens', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const tpl = { ...w.state.templates[0] };
  w.state.journeys = [];
  const out = await s.previewTemplate(tpl, 'india');
  expect(out?.html).not.toContain('%%DO_');
  expect(out?.html).toMatch(/no journey with product prices/);
  expect(out?.markets).toBe(undefined);
  const render = await s.renderTemplateFor(tpl, { plan: 'IN', currency: 'INR' });
  expect(render?.error).toBeTruthy();
});

test('subject: the AI lead is used, the price suffix stays, and the source is recorded', async () => {
  const w = world();
  const ai: SuggestSubjectFn = async () => ({ lead: 'Visas for your next trip, sorted ✈️', source: 'ai', reason: null });
  await svc(w, { suggestSubject: ai }).runCreate({ now: NINE_AM });
  expect(w.state.templates[0].subject).toBe('Visas for your next trip, sorted ✈️ – from %%DO_FROM%%');
  expect(labelOf(w.state.journeys[0]).subject).toEqual({ source: 'ai', reason: null, lead: 'Visas for your next trip, sorted ✈️', standardLead: 'Visas for UAE, USA, Schengen & more' });
});

test('subject: the AI lead survives the 3:45 final check', async () => {
  const w = world();
  const ai: SuggestSubjectFn = async () => ({ lead: 'Visas for your next trip, sorted', source: 'ai', reason: null });
  await svc(w, { suggestSubject: ai }).runCreate({ now: NINE_AM });
  const res = await svc(w).runFinalCheck({ now: CHECK });
  expect(res.status, 'message' in res ? res.message : '').toBe('scheduled');
  expect(w.state.templates[0].subject).toBe('Visas for your next trip, sorted – from %%DO_FROM%%');
});

test('subject: AI unavailable → standard subject, reason recorded', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  expect(w.state.templates[0].subject).toBe('Visas for UAE, USA, Schengen & more – from %%DO_FROM%%');
  expect(labelOf(w.state.journeys[0]).subject?.source).toBe('fallback');
});

test('send check: scheduled journey with no sends → not_sent; with sends → sent', async () => {
  const day = (sent: number[]) => world({ journeys: [past(10, '2026-11-07', 4, 'visa', 'active')], sentJourneys: sent });
  const at = new Date('2026-11-07T13:30:00Z');   // 17:30 Dubai
  const quiet = await svc(day([])).runSendCheck({ now: at });
  expect(quiet.status).toBe('not_sent');
  if (quiet.status !== 'not_sent') return;
  expect(quiet.journeyId).toBe(10);
  expect(quiet.message).toMatch(/No emails sent by 17:30 Dubai \(send time 16:00/);
  expect((await svc(day([10])).runSendCheck({ now: at })).status).toBe('sent');
});

test('send check: no journey today, or one already skipped → nothing to check', async () => {
  const at = new Date('2026-11-07T13:30:00Z');
  expect((await svc(world()).runSendCheck({ now: at })).status).toBe('none');
  const skipped = world({ journeys: [past(11, '2026-11-07', 4, 'visa', 'draft', { status: 'skipped' })] });
  expect((await svc(skipped).runSendCheck({ now: at })).status).toBe('skipped_earlier');
});
