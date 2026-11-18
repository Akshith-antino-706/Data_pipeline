import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake DB, relay and queue — nothing reaches a real database, mail relay or Redis.
const state = vi.hoisted(() => ({
  failedCount: 0,
  dbFails: false,
  updates: [] as unknown[][],
  sentTo: [] as string[],
}));
vi.hoisted(() => { delete process.env.WELCOME_EMAILS; });   // allow-list off: sends only reach the fake relay
const fakeQuery = vi.hoisted(() => async (sql: string, params: unknown[] = []) => {
  if (/COUNT\(\*\)::int AS n FROM email_send_log/.test(sql)) {
    if (state.dbFails) throw new Error('db down');
    return { rows: [{ n: state.failedCount }] };
  }
  if (/UPDATE gtm_journey_entries SET status='exited'/.test(sql)) { state.updates.push(params); return { rowCount: 1, rows: [] }; }
  return { rows: [] };
});
vi.mock('../../src/config/database.js', () => ({ default: { query: fakeQuery }, query: fakeQuery }));
vi.mock('../../src/services/queue/index.js', () => ({ getConnection: vi.fn(() => ({})), enqueueGtmJourney: vi.fn() }));
vi.mock('../../src/services/channels/ChatheadEmailChannel.js', () => ({
  default: { send: async ({ to }: { to: string }) => { state.sentTo.push(to); return { success: true, provider: 'fake' }; } },
}));

const { sendJourneyEmail } = await import('../../src/services/channels/JourneyEmailSender.js');
const { default: GtmJourneyService } = await import('../../src/services/GtmJourneyService.js');

beforeEach(() => { state.failedCount = 0; state.dbFails = false; state.updates = []; state.sentTo = []; });

const failed = { unifiedId: 1909909, journeyId: 328, nodeId: 'node_1', entryId: 689568, error: 'HTTP 200' };

describe('journey emails — recipient trim and repeated failures', () => {
  it('the recipient is trimmed before it reaches the relay (trailing line break, spaces, tab)', async () => {
    for (const to of ['guest@gmail.com\n', ' \tguest@gmail.com \r\n', 'guest@gmail.com']) {
      await sendJourneyEmail({ emailCredential: 'default', to, subject: 'Hi', html: '<p>x</p>', unifiedId: 1 });
    }
    expect(state.sentTo).toEqual(['guest@gmail.com', 'guest@gmail.com', 'guest@gmail.com']);
  });

  it('fewer than 3 failed sends → keep retrying (entry untouched)', async () => {
    for (const n of [1, 2]) {
      state.failedCount = n;
      expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(false);
    }
    expect(state.updates).toHaveLength(0);
  });

  it('3rd failed send → entry exited as send_failed, no more retries', async () => {
    state.failedCount = 3;
    expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(true);
    expect(state.updates).toEqual([[689568]]);
  });

  it('an entry already stuck in a loop (108 failures) is exited on its next failure', async () => {
    state.failedCount = 108;
    expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(true);
    expect(state.updates).toHaveLength(1);
  });

  it('no entry id (not a continuous-journey send) → never exits, old retry behaviour', async () => {
    state.failedCount = 50;
    expect(await GtmJourneyService._exitAfterRepeatedFailures({ ...failed, entryId: null })).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("if the failure count can't be read, keep retrying — never drop a recipient on a DB error", async () => {
    state.dbFails = true;
    expect(await GtmJourneyService._exitAfterRepeatedFailures(failed)).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});
