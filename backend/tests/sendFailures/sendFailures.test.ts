import { test, expect, vi, beforeEach } from 'vitest';

// Never reach a real database, relay or Redis: tests/setup.ts points them at closed ports,
// and the modules are replaced here.
const t = vi.hoisted(() => {
  delete process.env.WELCOME_EMAILS;   // allow-list off: sends only ever reach the fake relay below
  return {
    failedCount: 0,
    dbFails: false,
    updates: [] as unknown[][],   // params of each exit UPDATE
    sentTo: [] as string[],       // who each email was sent to
  };
});

// Fake DB: answers the failure count, records the exit UPDATE.
const { fakeQuery } = vi.hoisted(() => ({
  fakeQuery: async (sql: string, params: unknown[] = []) => {
    if (/COUNT\(\*\)::int AS n FROM email_send_log/.test(sql)) {
      if (t.dbFails) throw new Error('db down');
      return { rows: [{ n: t.failedCount }] };
    }
    if (/UPDATE gtm_journey_entries SET status='exited'/.test(sql)) { t.updates.push(params); return { rowCount: 1, rows: [] }; }
    return { rows: [] };
  },
}));
vi.mock('../../src/config/database.js', () => ({
  default: { query: fakeQuery }, query: fakeQuery, transaction: async () => { throw new Error('no db in tests'); },
}));

// Fake relay transport: records who each email was sent to.
vi.mock('../../src/services/channels/ChatheadEmailChannel.js', () => ({
  default: { send: async ({ to }: { to: string }) => { t.sentTo.push(to); return { success: true, provider: 'fake' }; } },
}));

import { sendJourneyEmail } from '../../src/services/channels/JourneyEmailSender.js';
import GtmJourneyService from '../../src/services/GtmJourneyService.js';

beforeEach(() => { t.failedCount = 0; t.dbFails = false; t.updates.length = 0; t.sentTo.length = 0; });

test('the recipient is trimmed before it reaches the relay (trailing line break, spaces, tab)', async () => {
  await sendJourneyEmail({ emailCredential: 'default', to: 'guest@gmail.com\n', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  await sendJourneyEmail({ emailCredential: 'default', to: ' \tguest@gmail.com \r\n', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  await sendJourneyEmail({ emailCredential: 'default', to: 'guest@gmail.com', subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
  expect(t.sentTo).toEqual(['guest@gmail.com', 'guest@gmail.com', 'guest@gmail.com']);
});

const failed = { unifiedId: 1909909, journeyId: 328, nodeId: 'node_1', entryId: 689568, error: 'HTTP 200' };

test('fewer than 3 failed sends → keep retrying (entry untouched)', async () => {
  for (const n of [1, 2]) {
    t.failedCount = n;
    expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(false);
  }
  expect(t.updates.length).toBe(0);
});

test('3rd failed send → entry exited as send_failed, no more retries', async () => {
  t.failedCount = 3;
  expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(true);
  expect(t.updates).toEqual([[689568]]);
});

test('an entry already stuck in a loop (108 failures) is exited on its next failure', async () => {
  t.failedCount = 108;
  expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(true);
  expect(t.updates.length).toBe(1);
});

test('no entry id (not a continuous-journey send) → never exits, old retry behaviour', async () => {
  t.failedCount = 50;
  expect(await GtmJourneyService._exitAfterRepeatedFailures({ ...failed, entryId: null })).toBe(false);
  expect(t.updates.length).toBe(0);
});

test('if the failure count can\'t be read, keep retrying — never drop a recipient on a DB error', async () => {
  t.dbFails = true;
  expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(false);
  expect(t.updates.length).toBe(0);
});
