import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDailyOfferCrons } from '../../src/services/dailyOffer/cron.js';

// Everything here is a stand-in: no database, no Claude, no email is sent.
const silent = { log() {}, warn() {}, error() {} };

/** Every field in `expected` matches `actual` (other fields are ignored). */
function assertHas(actual, expected) {
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual?.[k], v, `field ${k}`);
}
const ON = { DAILY_OFFER_ENABLED: 'true', EMAIL_CAP_BYPASS_EMAILS: 'team@x.com' };

/** Dubai wall-clock → instant (Dubai is UTC+4 all year). */
const dubai = (date, hhmm) => new Date(`${date}T${hhmm}:00+04:00`);

/**
 * Registers the crons against fakes and returns handles to drive them.
 * `results` decides what each run returns (or throws) at the moment it is called.
 */
function setup({ env = ON, results = {}, createGate } = {}) {
  const jobs = new Map();
  const timezones = [];
  const alerts = [];
  const calls = { create: 0, finalCheck: 0, sendCheck: 0 };
  let clock = dubai('2026-11-04', '09:00');

  const service = {
    async runCreate() { calls.create += 1; if (createGate) await createGate; return (results.create ?? (() => ({ status: 'created', journeyId: 1, templateId: 1, name: 'x', count: 10 })))(); },
    async runFinalCheck() { calls.finalCheck += 1; return (results.finalCheck ?? (() => ({ status: 'scheduled', journeyId: 1, count: 10, dropped: [] })))(); },
    async runSendCheck() { calls.sendCheck += 1; return (results.sendCheck ?? (() => ({ status: 'sent', journeyId: 1 })))(); },
  };
  const on = registerDailyOfferCrons(
    { schedule: (expr, fn, opts) => { jobs.set(expr, fn); timezones.push(opts?.timezone); } },
    {
      env, log: silent,
      makeService: () => service,
      sendAlert: async (a) => { alerts.push(a); return 1; },
      now: () => clock,
    },
  );
  const run = async (expr, date, hhmm) => {
    clock = dubai(date, hhmm);
    const job = jobs.get(expr);
    if (!job) throw new Error(`no job scheduled at "${expr}"`);
    await job();
  };
  return { on, jobs, timezones, alerts, calls, run };
}

const CREATE = '*/30 * * * *';
const FINAL = '45 15 * * *';
const SEND = '30 17 * * *';
const skippedCreate = () => ({ status: 'skipped', reason: 'feed_not_today', message: 'Feed was not built today' });

// ── Registration ──

test('cron: off unless DAILY_OFFER_ENABLED=true — nothing scheduled', () => {
  const s = setup({ env: {} });
  assert.equal(s.on, false);
  assert.equal(s.jobs.size, 0);
});

test('cron: create every 30 min, final check 15:45, send check 17:30 — all Dubai time', () => {
  const s = setup();
  assert.equal(s.on, true);
  assert.deepEqual([...s.jobs.keys()], [CREATE, FINAL, SEND]);
  assert.equal(s.timezones.every(tz => tz === 'Asia/Dubai'), true);
});

test('cron: send check time follows DAILY_OFFER_SEND_CHECK_AT', () => {
  const s = setup({ env: { ...ON, DAILY_OFFER_SEND_CHECK_AT: '18:00' } });
  assert.ok(([...s.jobs.keys()]).includes('0 18 * * *'), `missing: ${'0 18 * * *'}`);
});

// ── Create window ──

test('create: only runs between 09:00 and 14:00 Dubai', async () => {
  const s = setup();
  await s.run(CREATE, '2026-11-04', '08:30');
  await s.run(CREATE, '2026-11-04', '14:30');
  assert.equal(s.calls.create, 0);
  await s.run(CREATE, '2026-11-04', '09:00');
  await s.run(CREATE, '2026-11-04', '14:00');
  assert.equal(s.calls.create, 2);
});

test('create: a failure with retries left sends no alert; the 14:00 failure does', async () => {
  const s = setup({ results: { create: skippedCreate } });
  for (const t of ['09:00', '09:30', '12:00', '13:30']) await s.run(CREATE, '2026-11-04', t);
  assert.deepEqual(s.alerts, []);
  await s.run(CREATE, '2026-11-04', '14:00');
  assert.equal((s.alerts).length, 1);
  assertHas(s.alerts[0], { date: '2026-11-04', stage: 'create', reason: 'feed_not_today', segmentId: 95 });
});

test('create: a crash with retries left is not alerted; a crash on the last try is', async () => {
  const s = setup({ results: { create: () => { throw new Error('db down'); } } });
  await s.run(CREATE, '2026-11-04', '10:00');
  assert.deepEqual(s.alerts, []);
  await s.run(CREATE, '2026-11-04', '14:00');
  assert.equal((s.alerts).length, 1);
  assertHas(s.alerts[0], { stage: 'create', reason: 'crash', message: 'db down' });
});

// ── One alert per day ──

test('alerts: a lost day alerts once, even when the later checks fail too', async () => {
  const s = setup({ results: { create: skippedCreate, finalCheck: () => ({ status: 'none', message: 'No daily offer journey for today' }) } });
  await s.run(CREATE, '2026-11-04', '14:00');
  await s.run(FINAL, '2026-11-04', '15:45');
  assert.equal((s.alerts).length, 1);
  assert.equal(s.alerts[0].stage, 'create');
});

test('alerts: the next failed day alerts again', async () => {
  const s = setup({ results: { finalCheck: () => ({ status: 'skipped', reason: 'audience_empty', message: 'Segment has no people', journeyId: 7 }) } });
  await s.run(FINAL, '2026-11-04', '15:45');
  await s.run(FINAL, '2026-11-05', '15:45');
  assert.deepEqual(s.alerts.map(a => a.date), ['2026-11-04', '2026-11-05']);
  assertHas(s.alerts[0], { stage: 'final check', reason: 'audience_empty', journeyId: 7 });
});

test('alerts: a good day sends none', async () => {
  const s = setup();
  await s.run(CREATE, '2026-11-04', '09:00');
  await s.run(FINAL, '2026-11-04', '15:45');
  await s.run(SEND, '2026-11-04', '17:30');
  assert.deepEqual(s.calls, { create: 1, finalCheck: 1, sendCheck: 1 });
  assert.deepEqual(s.alerts, []);
});

test('alerts: 17:30 with nothing sent alerts with the journey number', async () => {
  const s = setup({ results: { sendCheck: () => ({ status: 'not_sent', journeyId: 552, message: 'No emails sent by 17:30 Dubai' }) } });
  await s.run(SEND, '2026-11-04', '17:30');
  assert.equal((s.alerts).length, 1);
  assertHas(s.alerts[0], { stage: 'send check', reason: 'not_sent', journeyId: 552 });
});

test('alerts: a final check crash alerts (no retry is left at 15:45)', async () => {
  const s = setup({ results: { finalCheck: () => { throw new Error('boom'); } } });
  await s.run(FINAL, '2026-11-04', '15:45');
  assertHas(s.alerts[0], { stage: 'final check', reason: 'crash', message: 'boom' });
});

// ── No overlap ──

test('runs never overlap — a job that fires while another is running is skipped', async () => {
  let release = () => {};
  const gate = new Promise(r => { release = r; });
  const s = setup({ createGate: gate });
  const first = s.run(CREATE, '2026-11-04', '14:00');   // held open inside runCreate
  await s.run(FINAL, '2026-11-04', '14:00');            // fires meanwhile → skipped
  assertHas(s.calls, { create: 1, finalCheck: 0 });
  release();
  await first;
  await s.run(FINAL, '2026-11-04', '15:45');            // free again → runs
  assert.equal(s.calls.finalCheck, 1);
});
