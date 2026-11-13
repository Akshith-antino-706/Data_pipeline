import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Never reach a real database, relay or Redis: point them at closed ports, then replace the modules.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
delete process.env.WELCOME_EMAILS;   // allow-list off: sends only ever reach the fake relay below

// Fake DB: answers the failure count, records the exit UPDATE.
let failedCount = 0, dbFails = false;
const updates = [];
const fakeQuery = async (sql, params = []) => {
  if (/COUNT\(\*\)::int AS n FROM email_send_log/.test(sql)) {
    if (dbFails) throw new Error('db down');
    return { rows: [{ n: failedCount }] };
  }
  if (/UPDATE gtm_journey_entries SET status='exited'/.test(sql)) { updates.push(params); return { rowCount: 1, rows: [] }; }
  return { rows: [] };
};
mock.module(new URL('../../src/config/database.js', import.meta.url).href, {
  exports: { default: { query: fakeQuery }, query: fakeQuery, transaction: async () => { throw new Error('no db in tests'); } },
});

// Fake relay transport: records who each email was sent to.
const sentTo = [];
mock.module(new URL('../../src/services/channels/ChatheadEmailChannel.js', import.meta.url).href, {
  exports: { default: { send: async ({ to }) => { sentTo.push(to); return { success: true, provider: 'fake' }; } } },
});

const { sendJourneyEmail } = await import('../../src/services/channels/JourneyEmailSender.js');
const { default: GtmJourneyService } = await import('../../src/services/GtmJourneyService.js');

beforeEach(() => { failedCount = 0; dbFails = false; updates.length = 0; sentTo.length = 0; });

test('the recipient is trimmed before it reaches the relay (trailing line break, spaces, tab)', async () => {
  await sendJourneyEmail({ emailCredential: 'default', to: 'guest@gmail.com\n', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  await sendJourneyEmail({ emailCredential: 'default', to: ' \tguest@gmail.com \r\n', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  await sendJourneyEmail({ emailCredential: 'default', to: 'guest@gmail.com', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  assert.deepEqual(sentTo, ['guest@gmail.com', 'guest@gmail.com', 'guest@gmail.com']);
});

const failed = { unifiedId: 1909909, journeyId: 328, nodeId: 'node_1', entryId: 689568, error: 'HTTP 200' };

test('fewer than 3 failed sends → keep retrying (entry untouched)', async () => {
  for (const n of [1, 2]) {
    failedCount = n;
    assert.equal(await GtmJourneyService._exitAfterRepeatedFailures(failed), false);
  }
  assert.equal(updates.length, 0);
});

test('3rd failed send → entry exited as send_failed, no more retries', async () => {
  failedCount = 3;
  assert.equal(await GtmJourneyService._exitAfterRepeatedFailures(failed), true);
  assert.deepEqual(updates, [[689568]]);
});

test('an entry already stuck in a loop (108 failures) is exited on its next failure', async () => {
  failedCount = 108;
  assert.equal(await GtmJourneyService._exitAfterRepeatedFailures(failed), true);
  assert.equal(updates.length, 1);
});

test('no entry id (not a continuous-journey send) → never exits, old retry behaviour', async () => {
  failedCount = 50;
  assert.equal(await GtmJourneyService._exitAfterRepeatedFailures({ ...failed, entryId: null }), false);
  assert.equal(updates.length, 0);
});

test('if the failure count can\'t be read, keep retrying — never drop a recipient on a DB error', async () => {
  dbFails = true;
  assert.equal(await GtmJourneyService._exitAfterRepeatedFailures(failed), false);
  assert.equal(updates.length, 0);
});
