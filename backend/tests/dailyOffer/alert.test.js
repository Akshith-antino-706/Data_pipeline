import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertFor, alertRecipients, sendFailureAlert } from '../../src/services/dailyOffer/alert.js';

const silent = { log() {}, warn() {}, error() {} };

test('alert: recipients — alert list first, else the QA bypass list; cleaned and de-duplicated', () => {
  assert.deepEqual(alertRecipients({ EMAIL_CAP_BYPASS_EMAILS: 'A@x.com, b@y.com,,not-an-email, a@x.com' }), ['a@x.com', 'b@y.com']);
  assert.deepEqual(alertRecipients({ DAILY_OFFER_ALERT_EMAILS: 'ops@x.com', EMAIL_CAP_BYPASS_EMAILS: 'a@x.com' }), ['ops@x.com']);
  assert.deepEqual(alertRecipients({}), []);
});

test('alert: create only alerts on the last attempt of the day', () => {
  const skipped = { status: 'skipped', reason: 'feed_not_today', message: 'Feed was not built today' };
  assert.equal(alertFor('create', skipped, { lastTry: false }), null);
  assert.equal(alertFor('create', skipped, { lastTry: true }).reason, 'feed_not_today');
  assert.equal(alertFor('create', { status: 'created' }, { lastTry: true }), null);
  assert.equal(alertFor('create', { status: 'exists' }, { lastTry: true }), null);
});

test('alert: final check alerts when skipped or when no journey exists; not when scheduled', () => {
  assert.equal(alertFor('final check', { status: 'skipped', reason: 'audience_empty', message: 'x', journeyId: 7 }).journeyId, 7);
  assert.equal(alertFor('final check', { status: 'none' }).reason, 'no_journey');
  assert.equal(alertFor('final check', { status: 'scheduled' }), null);
  assert.equal(alertFor('final check', { status: 'already_scheduled' }), null);
  assert.equal(alertFor('final check', { status: 'skipped_earlier' }), null);
});

test('alert: send check alerts only when nothing was sent', () => {
  assert.equal(alertFor('send check', { status: 'not_sent', journeyId: 9, message: 'none' }).reason, 'not_sent');
  assert.equal(alertFor('send check', { status: 'sent' }), null);
  assert.equal(alertFor('send check', { status: 'none' }), null);
});

test('alert: one email per team inbox with date, step and reason; a failed send does not throw', async () => {
  const sent = [];
  const send = async (m) => { sent.push(m); if (m.to === 'b@y.com') throw new Error('smtp down'); return { success: true }; };
  const n = await sendFailureAlert({
    date: '2026-11-04', stage: 'final check', reason: 'audience_empty', message: 'Segment has <no> people', journeyId: 552,
    segmentId: 86, send, env: { EMAIL_CAP_BYPASS_EMAILS: 'a@x.com,b@y.com' }, log: silent,
  });
  assert.equal(n, 1);
  assert.deepEqual(sent.map(m => m.to), ['a@x.com', 'b@y.com']);
  assert.equal(sent[0].subject, '⚠️ Daily offer email not sent — 4th November');
  assert.match(sent[0].html, /audience_empty/);
  assert.match(sent[0].html, /Segment has &lt;no&gt; people/);
  assert.match(sent[0].html, /#552/);
  assert.match(sent[0].html, /raynatourslogo/);
});

test('alert: no recipients → nothing sent', async () => {
  let calls = 0;
  const n = await sendFailureAlert({ date: '2026-11-04', stage: 'create', reason: 'x', message: 'y', segmentId: 86, send: async () => { calls += 1; return { success: true }; }, env: {}, log: silent });
  assert.equal(n, 0);
  assert.equal(calls, 0);
});
