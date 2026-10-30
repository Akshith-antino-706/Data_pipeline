import { test } from 'node:test';
import assert from 'node:assert/strict';
import DailyOfferService, { ordinalDate } from '../../src/services/dailyOffer/DailyOfferService.js';
import { getDailyOfferConfig } from '../../src/services/dailyOffer/config.js';
import { validateFeed } from '../../src/services/dailyOffer/feed.js';
import { fullFeed } from './fixtures.js';

const NINE_AM = new Date('2026-11-01T05:00:00Z');        // 09:00 Dubai
const CHECK = new Date('2026-11-01T11:45:00Z');          // 15:45 Dubai
const silent = { log() {}, warn() {}, error() {} };

/** In-memory stand-ins for the database and the two services the job uses. */
function world({ journeys = [], segment = { id: 95, name: 'B2C Testing Email Users', is_active: true }, fxAgeHours = 3 } = {}) {
  const state = { journeys: [...journeys], templates: [], nextJourney: 1000, nextTemplate: 500 };
  const db = {
    async query(sql, params = []) {
      if (sql.includes('FROM journey_flows') && sql.includes('dailyOffer')) {
        return { rows: [...state.journeys].sort((a, b) => b.journey_id - a.journey_id) };
      }
      if (sql.includes('FROM journey_flows') && sql.includes('nodes @> $1')) {
        const tid = JSON.parse(params[0])[0].data.emailTemplateId;
        return { rows: state.journeys.filter(j => j.nodes.some(n => n.data?.emailTemplateId === tid)) };
      }
      if (sql.includes('FROM custom_segments')) return { rows: segment ? [segment] : [] };
      if (sql.includes('FROM fx_rates')) {
        const at = new Date(NINE_AM.getTime() - fxAgeHours * 3600000);
        return { rows: [['INR', 25.95], ['SAR', 1.02], ['USD', 0.2723]].map(([currency, r]) => ({ currency, aed_to_currency: r, updated_at: at })) };
      }
      if (sql.includes('FROM content_templates')) return { rows: state.templates.filter(t => t.id === params[0]) };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const services = {
    ContentService: {
      async create(t) { const row = { id: state.nextTemplate++, ...t }; state.templates.push(row); return row; },
      async update(id, f) { Object.assign(state.templates.find(t => t.id === id), f); },
      async delete(id) { state.templates = state.templates.filter(t => t.id !== id); },
    },
    JourneyService: {
      async create(j) {
        const row = { journey_id: state.nextJourney++, status: 'draft', snapshot_count: 4, scheduled_start_at: null, ...j };
        state.journeys.push(row); return row;
      },
      async update(id, f) {
        const j = state.journeys.find(x => x.journey_id === id);
        Object.assign(j, f);
      },
    },
  };
  return { state, db, services };
}

function svc(w, { feed = (now) => validateFeed(fullFeed(now), { now }), env = {} } = {}) {
  return new DailyOfferService({
    db: w.db, services: w.services, log: silent,
    config: getDailyOfferConfig({ DAILY_OFFER_ENABLED: 'true', ...env }),
    fetchFeed: async ({ now }) => feed(now),
  });
}

/** A past daily-offer journey with the given loop day / status. */
function past(id, date, loopDay, theme, status = 'completed', extra = {}) {
  return { journey_id: id, status, scheduled_start_at: null, snapshot_count: 4,
    nodes: [{ id: 'node_0', data: {} }, { id: 'node_1', data: { emailTemplateId: id, dailyOffer: { date, loopDay, theme, productKeys: [], status: 'scheduled', ...extra } } }] };
}

test('names: ordinal dates', () => {
  assert.equal(ordinalDate('2026-11-01'), '1st November');
  assert.equal(ordinalDate('2026-11-02'), '2nd November');
  assert.equal(ordinalDate('2026-11-11'), '11th November');
  assert.equal(ordinalDate('2026-11-23'), '23rd November');
});

test('create: first run makes Day 1 (Visa) template + Draft journey with no start time', async () => {
  const w = world();
  const res = await svc(w).runCreate({ now: NINE_AM });
  assert.equal(res.status, 'created');
  assert.equal(res.name, '1st November - Visa Offers (Day 1)');
  const j = w.state.journeys[0];
  assert.equal(j.segmentId, 'custom:95');
  assert.equal(j.scheduledStartAt, null);
  assert.equal(j.journeyType, 'fixed');
  const node = j.nodes[1];
  assert.equal(node.data.emailTemplateId, w.state.templates[0].id);
  assert.equal(node.data.dailyOffer.loopDay, 1);
  assert.equal(node.data.dailyOffer.products.length, 10);
  assert.ok(w.state.templates[0].body.startsWith('<!--DAILY_OFFER-->'));
  assert.equal(w.state.templates[0].createdBy, 'daily-offer-automation');
});

test('create: runs again the same day → nothing new (no duplicate, no download)', async () => {
  const w = world();
  let downloads = 0;
  const s = svc(w, { feed: (now) => { downloads += 1; return validateFeed(fullFeed(now), { now }); } });
  await s.runCreate({ now: NINE_AM });
  const again = await s.runCreate({ now: new Date(NINE_AM.getTime() + 30 * 60000) });
  assert.equal(again.status, 'exists');
  assert.equal(w.state.journeys.length, 1);
  assert.equal(downloads, 1);
});

test('create: continues the loop from the last journey that actually sent', async () => {
  const w = world({ journeys: [past(10, '2026-10-31', 4, 'visa')] });
  const res = await svc(w).runCreate({ now: NINE_AM });
  assert.match(res.name, /Cruises \(Day 5\)$/);
});

test('create: a skipped day carries its theme to the next day (Draft journey does not count)', async () => {
  const w = world({ journeys: [
    past(10, '2026-10-30', 1, 'visa'),
    past(11, '2026-10-31', 2, 'holiday_multi', 'draft', { status: 'skipped' }),
  ] });
  const res = await svc(w).runCreate({ now: NINE_AM });
  assert.match(res.name, /Holiday Packages \(Day 2\)$/);
});

test('create: skipped (nothing saved) when the feed is not today', async () => {
  const w = world();
  const stale = (now) => { const b = fullFeed(now); b.generatedAt = '2026-10-30T01:00:00Z'; return validateFeed(b, { now }); };
  const res = await svc(w, { feed: stale }).runCreate({ now: NINE_AM });
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'feed_not_today');
  assert.equal(w.state.journeys.length + w.state.templates.length, 0);
});

test('create: skipped when there are fewer than the minimum products', async () => {
  const w = world();
  const res = await svc(w, { env: { DAILY_OFFER_MIN_PRODUCTS: '11' } }).runCreate({ now: NINE_AM });   // visa day has 10
  assert.equal(res.reason, 'too_few_products');
  assert.equal(w.state.templates.length, 0);
});

test('create: skipped when exchange rates are stale or the segment is missing', async () => {
  assert.equal((await svc(world({ fxAgeHours: 60 })).runCreate({ now: NINE_AM })).reason, 'fx_stale');
  assert.equal((await svc(world({ segment: null })).runCreate({ now: NINE_AM })).reason, 'segment_missing');
  assert.equal((await svc(world({ segment: { id: 95, name: 'x', is_active: false } })).runCreate({ now: NINE_AM })).reason, 'segment_inactive');
});

test('final check: passes → start time set to 4 PM Dubai, prices refreshed', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const res = await s.runFinalCheck({ now: CHECK });
  assert.equal(res.status, 'scheduled', res.message);
  const j = w.state.journeys[0];
  assert.equal(j.scheduled_start_at, '2026-11-01T12:00:00.000Z');   // 16:00 Dubai
  assert.equal(j.nodes[1].data.dailyOffer.status, 'scheduled');
  // Runs again → no change.
  assert.equal((await s.runFinalCheck({ now: CHECK })).status, 'already_scheduled');
});

test('final check: products that became unavailable are dropped', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  const usOff = (now) => {
    const b = fullFeed(now);
    b.products.find(p => p.url.endsWith('/usa-visa')).price_availabilityStatus = 'unavailable';
    return validateFeed(b, { now });
  };
  const res = await svc(w, { feed: usOff }).runFinalCheck({ now: CHECK });
  assert.equal(res.status, 'scheduled', res.message);
  assert.equal(res.count, 9);
  assert.equal(res.dropped.length, 1);
  assert.ok(!w.state.templates[0].body.includes('/usa-visa'));
});

test('final check: fails → no start time, reason written into the description', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  w.state.journeys[0].snapshot_count = -2;
  const res = await svc(w).runFinalCheck({ now: CHECK });
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'audience_failed');
  const j = w.state.journeys[0];
  assert.equal(j.scheduled_start_at, null);
  assert.match(j.description, /^Not sent: Audience list failed to build/);
  assert.equal((await svc(w).runFinalCheck({ now: CHECK })).status, 'skipped_earlier');
});

test('final check: feed broken at 3:45 → not sent', async () => {
  const w = world();
  await svc(w).runCreate({ now: NINE_AM });
  const broken = () => { throw Object.assign(new Error('Feed returned HTTP 503'), { reason: 'feed_http_error' }); };
  const res = await svc(w, { feed: broken }).runFinalCheck({ now: CHECK });
  assert.equal(res.status, 'skipped');
  assert.equal(w.state.journeys[0].scheduled_start_at, null);
});

test('preview: View as India / UAE renders real prices for the saved template', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const tpl = { ...w.state.templates[0] };
  const india = await s.previewTemplate(tpl, 'india');
  const uae = await s.previewTemplate(tpl, 'uae');
  assert.equal(india.currency, 'INR');
  assert.match(india.subject, /from ₹/);
  assert.match(uae.subject, /from AED /);
  assert.ok(!india.html.includes('%%DO_'));
  assert.deepEqual(india.markets.map(m => m.key), ['india', 'uae', 'saudi', 'other', 'none']);
  assert.equal(await s.previewTemplate({ id: 1, body: '<html>other template</html>' }, 'india'), null);
});

test('memory: repeated runs do not grow the heap', { skip: typeof global.gc !== 'function' && 'run with --expose-gc' }, async () => {
  const run = async () => { const w = world(); const s = svc(w); await s.runCreate({ now: NINE_AM }); await s.runFinalCheck({ now: CHECK }); };
  for (let i = 0; i < 5; i++) await run();
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 40; i++) await run();
  global.gc();
  const grown = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.ok(grown < 5, `heap grew ${grown.toFixed(1)} MB over 40 runs`);
});

test('create: if saving the journey fails, the template it just saved is removed', async () => {
  const w = world();
  w.services.JourneyService.create = async () => { throw new Error('db down'); };
  const res = await svc(w).runCreate({ now: NINE_AM });
  assert.equal(res.status, 'skipped');
  assert.equal(w.state.templates.length, 0);
});

test('preview: a daily template whose journey is gone shows a clear message, never raw tokens', async () => {
  const w = world();
  const s = svc(w);
  await s.runCreate({ now: NINE_AM });
  const tpl = { ...w.state.templates[0] };
  w.state.journeys = [];
  const out = await s.previewTemplate(tpl, 'india');
  assert.ok(!out.html.includes('%%DO_'));
  assert.match(out.html, /no journey with product prices/);
  assert.equal(out.markets, undefined);
  const render = await s.renderTemplateFor(tpl, { plan: 'IN', currency: 'INR' });
  assert.ok(render.error);
});
