import { test } from 'node:test';
import assert from 'node:assert/strict';
import DailyOfferService from '../../src/services/dailyOffer/DailyOfferService.js';
import { getDailyOfferConfig, audienceOf } from '../../src/services/dailyOffer/config.js';
import { registerDailyOfferCrons } from '../../src/services/dailyOffer/cron.js';
import { buildTemplate } from '../../src/services/dailyOffer/render.js';
import { validateFeed } from '../../src/services/dailyOffer/feed.js';
import { alertHtml } from '../../src/services/dailyOffer/alert.js';
import { fullFeed } from './fixtures.js';

// Everything here is a stand-in: no database, no Claude, no email is sent.
const silent = { log() {}, warn() {}, error() {} };
const NINE_AM   = new Date('2026-11-07T05:00:00Z');   // 09:00 Dubai — loop Day 4, Visa
const NINE_15   = new Date('2026-11-07T05:15:00Z');   // 09:15 Dubai — first B2B attempt
const B2B_CHECK = new Date('2026-11-07T07:45:00Z');   // 11:45 Dubai
const B2C_CHECK = new Date('2026-11-07T11:45:00Z');   // 15:45 Dubai
const PORTAL = 'https://www.raynab2b.com';
const ON_BOTH = { DAILY_OFFER_ENABLED: 'true', DAILY_OFFER_B2B_ENABLED: 'true', DAILY_OFFER_SEGMENT_ID: '86', DAILY_OFFER_B2B_SEGMENT_ID: '87' };

/** In-memory stand-ins for the database and the two services (same shape as service.test.js). */
function world({ journeys = [], fxAgeHours = 3, sentJourneys = [] } = {}) {
  const state = { journeys: [...journeys], templates: [], nextJourney: 1000, nextTemplate: 500 };
  const segments = { 86: { id: 86, name: 'B2C - Subscribed Users only', is_active: true }, 87: { id: 87, name: 'B2B - Subscribed Users Only', is_active: true } };
  const db = {
    async query(sql, params = []) {
      if (sql.includes('FROM journey_flows') && sql.includes('dailyOffer')) return { rows: [...state.journeys].sort((a, b) => b.journey_id - a.journey_id) };
      if (sql.includes('FROM custom_segments')) return { rows: segments[params[0]] ? [segments[params[0]]] : [] };
      if (sql.includes('FROM fx_rates')) {
        const at = new Date(NINE_AM.getTime() - fxAgeHours * 3600000);
        return { rows: [['INR', 25.95], ['SAR', 1.02], ['USD', 0.2723]].map(([currency, r]) => ({ currency, aed_to_currency: r, updated_at: at })) };
      }
      if (sql.includes('FROM content_templates')) return { rows: state.templates.filter(t => t.id === params[0]) };
      if (sql.includes('FROM email_send_log')) return { rows: sentJourneys.includes(params[0]) ? [{ '?column?': 1 }] : [] };
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
      async create(j) { const row = { journey_id: state.nextJourney++, status: 'draft', snapshot_count: 4, scheduled_start_at: null, ...j }; state.journeys.push(row); return row; },
      async update(id, f) { Object.assign(state.journeys.find(x => x.journey_id === id), f); },
    },
  };
  return { state, db, services };
}
const noAi = async (pick) => ({ lead: pick.subjectLead, source: 'fallback', reason: 'no_api_key' });
const aiLead = async () => ({ lead: 'Visas for your next trip, sorted ✈️', source: 'ai', reason: null });
const feedOf = (now) => validateFeed(fullFeed(now), { now });

function svc(w, audience, { feed = feedOf, env = {}, suggestSubject = noAi } = {}) {
  return new DailyOfferService({
    db: w.db, services: w.services, log: silent, suggestSubject,
    config: getDailyOfferConfig({ ...ON_BOTH, ...env }, audience),
    fetchFeed: async ({ now }) => feed(now),
  });
}
const b2cJourney = (w) => w.state.journeys.find(j => audienceOf(j.nodes[1].data.dailyOffer) === 'b2c');
const b2bJourney = (w) => w.state.journeys.find(j => audienceOf(j.nodes[1].data.dailyOffer) === 'b2b');
const templateOf = (w, j) => w.state.templates.find(t => t.id === j.nodes[1].data.emailTemplateId);
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

// ── Config ──

test('config: B2B profile is off by default and reads its own DAILY_OFFER_B2B_* values', () => {
  const off = getDailyOfferConfig({ DAILY_OFFER_ENABLED: 'true' }, 'b2b');
  assert.equal(off.enabled, false);
  assert.equal(getDailyOfferConfig({ DAILY_OFFER_B2B_ENABLED: 'true' }, 'b2b').segmentId, 95);   // trial inboxes until the team switches it to 87
  const on = getDailyOfferConfig(ON_BOTH, 'b2b');
  assert.equal(on.enabled, true);
  assert.equal(on.audience, 'b2b');
  assert.equal(on.segmentId, 87);
  assert.deepEqual([on.createAt, on.retryUntil, on.checkAt, on.sendAt, on.sendCheckAt], ['09:15', '11:15', '11:45', '12:00', '13:30']);
  assert.deepEqual(on.links, { productUrl: PORTAL, ctaUrl: PORTAL, ctaLabel: 'Click Here For B2B Rates' });
  // B2C is untouched by the B2B variables.
  const b2c = getDailyOfferConfig(ON_BOTH, 'b2c');
  assert.equal(b2c.audience, 'b2c');
  assert.equal(b2c.segmentId, 86);
  assert.equal(b2c.sendAt, '16:00');
  assert.equal(b2c.links, null);
  assert.equal(audienceOf({ date: '2026-11-07' }), 'b2c');   // rows saved before the B2B job
  assert.equal(audienceOf({ audience: 'b2b' }), 'b2b');
});

// ── Render ──

test('render: with links every product card and the button open the B2B portal; without, the feed pages', () => {
  const feed = feedOf(NINE_AM);
  const products = feed.products.slice(0, 4);
  const pick = { loopDay: 4, theme: 'visa', themeName: 'Visa Offers', subjectLead: 'Visas', count: 4,
    groups: [{ title: 'Visas', subtitle: '', products }], productKeys: products.map(p => p.key) };
  const b2b = buildTemplate(pick, getDailyOfferConfig(ON_BOTH, 'b2b').links);
  const b2c = buildTemplate(pick);
  for (const p of products) {
    assert.ok(b2c.includes(`href="${p.url}"`), `B2C links to ${p.url}`);
    assert.ok(!b2b.includes(p.url), `B2B must not link to ${p.url}`);
  }
  assert.equal(hrefs(b2b).filter(h => h === PORTAL).length, products.length * 2 + 2);   // image + title per card, plus the button (Outlook VML + normal link)
  assert.ok(b2b.includes('CLICK HERE FOR B2B RATES') || b2b.includes('Click Here For B2B Rates'));
  assert.ok(b2c.includes('Explore All Visas'));
  // B2B drops the consumer promo blocks (giveaways, affiliate programme) like the hand-made B2B emails; B2C keeps them.
  for (const promo of ['raynatours.com/giveaways', 'affiliates.raynatours.com', 'Enter Now']) {
    assert.ok(b2c.includes(promo), `B2C keeps ${promo}`);
    assert.ok(!b2b.includes(promo), `B2B has no ${promo}`);
  }
  assert.ok(b2b.includes('Privacy Policy') && b2b.includes('Verified by the platforms'));   // footer + trust badges stay
  // Same products, names and price tokens in both.
  for (const p of products) {
    assert.ok(b2b.includes(`%%DO_PRICE:${p.key}%%`) && b2c.includes(`%%DO_PRICE:${p.key}%%`));
    assert.ok(b2b.includes(p.name) && b2c.includes(p.name));
  }
});

// ── Create ──

test('create (B2B): waits while the B2C journey of the day does not exist yet — nothing saved', async () => {
  const w = world();
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'waiting_for_b2c');
  assert.equal(w.state.journeys.length + w.state.templates.length, 0);
});

test('create (B2B): copies the B2C day — same products, theme and subject; B2B segment, name and portal links', async () => {
  const w = world();
  await svc(w, 'b2c', { suggestSubject: aiLead }).runCreate({ now: NINE_AM });
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  assert.equal(res.status, 'created', res.message);
  assert.equal(res.name, '7th November - Visa Offers (Day 4) - B2B');
  const b2c = b2cJourney(w), b2b = b2bJourney(w);
  assert.equal(b2b.segmentId, 'custom:87');
  assert.equal(b2c.segmentId, 'custom:86');
  assert.equal(b2b.scheduledStartAt, null);
  const lc = b2c.nodes[1].data.dailyOffer, lb = b2b.nodes[1].data.dailyOffer;
  assert.deepEqual(lb.productKeys, lc.productKeys);
  assert.deepEqual(lb.products, lc.products);                 // same names + per-market prices
  assert.equal(lb.loopDay, 4); assert.equal(lb.theme, 'visa');
  assert.equal(lb.audience, 'b2b'); assert.equal(lb.mirrorOf, b2c.journey_id);
  assert.equal(lc.audience, undefined);
  assert.equal(templateOf(w, b2b).subject, templateOf(w, b2c).subject);   // AI subject carried over
  assert.equal(lb.subject.source, 'mirror');
  const html = templateOf(w, b2b).body;
  assert.ok(!html.includes('raynatours.com/visas'));
  assert.ok(html.includes(`href="${PORTAL}"`));
  assert.ok(templateOf(w, b2c).body.includes('https://www.raynatours.com/'));
});

test('create (B2B): runs again the same day → exists; a B2C re-run still sees only its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  assert.equal((await svc(w, 'b2b').runCreate({ now: new Date(NINE_15.getTime() + 30 * 60000) })).status, 'exists');
  const again = await svc(w, 'b2c').runCreate({ now: new Date(NINE_AM.getTime() + 60 * 60000) });
  assert.equal(again.status, 'exists');
  assert.equal(again.journeyId, b2cJourney(w).journey_id);
  assert.equal(w.state.journeys.length, 2);
});

test('create (B2C): the B2B journeys never change the B2C product rotation', async () => {
  // A completed B2B cruise day with product keys that B2C has never sent.
  const b2bPast = { journey_id: 10, status: 'completed', scheduled_start_at: null, snapshot_count: 4,
    nodes: [{ id: 'node_0', data: {} }, { id: 'node_1', data: { emailTemplateId: 10,
      dailyOffer: { date: '2026-11-05', loopDay: 2, theme: 'cruise', status: 'scheduled', audience: 'b2b', productKeys: ['cruise-1', 'cruise-2'] } } }] };
  const w = world({ journeys: [b2bPast] });
  const plan = await svc(w, 'b2c').planToday(await svc(w, 'b2c').recentJourneys(), '2026-11-09');   // cruise day
  assert.deepEqual(plan.previous.productKeys, []);
});

test('create (B2B): skipped (not saved) when the segment is missing or the B2C day was marked not sent', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  assert.equal((await svc(w, 'b2b', { env: { DAILY_OFFER_B2B_SEGMENT_ID: '999' } }).runCreate({ now: NINE_15 })).reason, 'segment_missing');
  b2cJourney(w).nodes[1].data.dailyOffer.status = 'skipped';
  const res = await svc(w, 'b2b').runCreate({ now: NINE_15 });
  assert.equal(res.reason, 'b2c_skipped');
  assert.equal(w.state.journeys.length, 1);
});

// ── Final check + send check ──

test('final check (B2B): passes → start time 12:00 Dubai; the B2C journey is left alone', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  const res = await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK });
  assert.equal(res.status, 'scheduled', res.message);
  assert.equal(b2bJourney(w).scheduled_start_at, '2026-11-07T08:00:00.000Z');   // 12:00 Dubai
  assert.equal(b2bJourney(w).nodes[1].data.dailyOffer.audience, 'b2b');          // label kept
  assert.equal(b2cJourney(w).scheduled_start_at, null);
  assert.ok(templateOf(w, b2bJourney(w)).body.includes(`href="${PORTAL}"`));     // links survive the refresh
  // B2C's own check later schedules only B2C at 16:00.
  assert.equal((await svc(w, 'b2c').runFinalCheck({ now: B2C_CHECK })).status, 'scheduled');
  assert.equal(b2cJourney(w).scheduled_start_at, '2026-11-07T12:00:00.000Z');
});

test('final check / send check (B2B): each audience only looks at its own journey', async () => {
  const w = world();
  await svc(w, 'b2c').runCreate({ now: NINE_AM });
  assert.equal((await svc(w, 'b2b').runFinalCheck({ now: B2B_CHECK })).status, 'none');
  await svc(w, 'b2b').runCreate({ now: NINE_15 });
  w.state.journeys.find(j => audienceOf(j.nodes[1].data.dailyOffer) === 'b2b').status = 'active';
  const at = new Date('2026-11-07T09:30:00Z');   // 13:30 Dubai
  const quiet = await svc(w, 'b2b').runSendCheck({ now: at });
  assert.equal(quiet.status, 'not_sent');
  assert.equal(quiet.journeyId, b2bJourney(w).journey_id);
  assert.match(quiet.message, /send time 12:00/);
  const sentW = world({ journeys: w.state.journeys, sentJourneys: [b2bJourney(w).journey_id] });
  assert.equal((await svc(sentW, 'b2b').runSendCheck({ now: at })).status, 'sent');
});

// ── Cron ──

const dubai = (date, hhmm) => new Date(`${date}T${hhmm}:00+04:00`);
function crons(env) {
  const jobs = new Map(); const calls = []; const alerts = []; let clock = dubai('2026-11-07', '09:00');
  const makeService = (config) => ({
    async runCreate() { calls.push(`${config.audience}:create`); return { status: 'skipped', reason: 'feed_not_today', message: 'x' }; },
    async runFinalCheck() { calls.push(`${config.audience}:final`); return { status: 'scheduled', journeyId: 1, count: 10, dropped: [] }; },
    async runSendCheck() { calls.push(`${config.audience}:send`); return { status: 'sent', journeyId: 1 }; },
  });
  const on = registerDailyOfferCrons({ schedule: (expr, fn) => jobs.set(expr, fn) },
    { env, log: silent, makeService, sendAlert: async (a) => { alerts.push(a); return 1; }, now: () => clock });
  const run = async (expr, hhmm) => { clock = dubai('2026-11-07', hhmm); await jobs.get(expr)(); };
  return { on, jobs, calls, alerts, run };
}

test('cron: B2B off → exactly the three B2C jobs as before', () => {
  const s = crons({ DAILY_OFFER_ENABLED: 'true' });
  assert.deepEqual([...s.jobs.keys()], ['*/30 * * * *', '45 15 * * *', '30 17 * * *']);
});

test('cron: B2B on → its own create (:15/:45 from 09:15 to 11:15), final check 11:45 and send check 13:30', async () => {
  const s = crons(ON_BOTH);
  assert.equal(s.on, true);
  assert.deepEqual([...s.jobs.keys()], ['*/30 * * * *', '45 15 * * *', '30 17 * * *', '15,45 * * * *', '45 11 * * *', '30 13 * * *']);
  await s.run('15,45 * * * *', '09:14');   // before the window
  await s.run('15,45 * * * *', '11:16');   // after it
  assert.deepEqual(s.calls, []);
  await s.run('15,45 * * * *', '09:15');
  await s.run('45 11 * * *', '11:45');
  await s.run('30 13 * * *', '13:30');
  assert.deepEqual(s.calls, ['b2b:create', 'b2b:final', 'b2b:send']);
});

test('cron: B2B alerts are separate from B2C and say so', async () => {
  const s = crons(ON_BOTH);
  await s.run('15,45 * * * *', '11:15');   // last B2B attempt failed → B2B alert
  await s.run('*/30 * * * *', '14:00');    // last B2C attempt failed → B2C alert, same day
  assert.deepEqual(s.alerts.map(a => [a.audience, a.segmentId, a.stage]), [['b2b', 87, 'create'], ['b2c', 86, 'create']]);
  const html = alertHtml({ date: '2026-11-07', stage: 'create', reason: 'x', message: 'y', segmentId: 87, audience: 'b2b' });
  assert.ok(html.includes('Daily offer email (B2B) not sent'));
  assert.ok(html.includes('B2B · Segment 87'));
  assert.ok(!alertHtml({ date: '2026-11-07', stage: 'create', reason: 'x', message: 'y', segmentId: 86 }).includes('(B2B)'));
});

test('cron: B2B can run alone (B2C off) — only its jobs are registered', () => {
  const s = crons({ DAILY_OFFER_B2B_ENABLED: 'true' });
  assert.deepEqual([...s.jobs.keys()], ['15,45 * * * *', '45 11 * * *', '30 13 * * *']);
});
