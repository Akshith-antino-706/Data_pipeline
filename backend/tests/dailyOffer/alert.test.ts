import { test, expect } from 'vitest';
import { alertFor, alertRecipients, sendFailureAlert } from '../../src/services/dailyOffer/alert.js';
import type { CreateResult } from '../../src/services/dailyOffer/DailyOfferService.js';

const silent = { log() {}, warn() {}, error() {} };

test('alert: recipients — alert list first, else the QA bypass list; cleaned and de-duplicated', () => {
  expect(alertRecipients({ EMAIL_CAP_BYPASS_EMAILS: 'A@x.com, b@y.com,,not-an-email, a@x.com' })).toEqual(['a@x.com', 'b@y.com']);
  expect(alertRecipients({ DAILY_OFFER_ALERT_EMAILS: 'ops@x.com', EMAIL_CAP_BYPASS_EMAILS: 'a@x.com' })).toEqual(['ops@x.com']);
  expect(alertRecipients({})).toEqual([]);
});

test('alert: create only alerts on the last attempt of the day', () => {
  const skipped: CreateResult = { status: 'skipped', reason: 'feed_not_today', message: 'Feed was not built today' };
  expect(alertFor('create', skipped, { lastTry: false })).toBe(null);
  expect(alertFor('create', skipped, { lastTry: true })?.reason).toBe('feed_not_today');
  expect(alertFor('create', { status: 'created', journeyId: 1, templateId: 1, name: 'x', count: 10 }, { lastTry: true })).toBe(null);
  expect(alertFor('create', { status: 'exists', journeyId: 1 }, { lastTry: true })).toBe(null);
});

test('alert: final check alerts when skipped or when no journey exists; not when scheduled', () => {
  expect(alertFor('final check', { status: 'skipped', reason: 'audience_empty', message: 'x', journeyId: 7 })?.journeyId).toBe(7);
  expect(alertFor('final check', { status: 'none', message: 'x' })?.reason).toBe('no_journey');
  expect(alertFor('final check', { status: 'scheduled', journeyId: 1, count: 10, dropped: [] })).toBe(null);
  expect(alertFor('final check', { status: 'already_scheduled', journeyId: 1 })).toBe(null);
  expect(alertFor('final check', { status: 'skipped_earlier', journeyId: 1 })).toBe(null);
});

test('alert: send check alerts only when nothing was sent', () => {
  expect(alertFor('send check', { status: 'not_sent', journeyId: 9, message: 'none' })?.reason).toBe('not_sent');
  expect(alertFor('send check', { status: 'sent', journeyId: 1 })).toBe(null);
  expect(alertFor('send check', { status: 'none' })).toBe(null);
});

test('alert: one email per team inbox with date, step and reason; a failed send does not throw', async () => {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const send = async (m: { to: string; subject: string; html: string }) => { sent.push(m); if (m.to === 'b@y.com') throw new Error('smtp down'); return { success: true }; };
  const n = await sendFailureAlert({
    date: '2026-11-04', stage: 'final check', reason: 'audience_empty', message: 'Segment has <no> people', journeyId: 552,
    segmentId: 86, send, env: { EMAIL_CAP_BYPASS_EMAILS: 'a@x.com,b@y.com' }, log: silent,
  });
  expect(n).toBe(1);
  expect(sent.map(m => m.to)).toEqual(['a@x.com', 'b@y.com']);
  expect(sent[0].subject).toBe('⚠️ Daily offer email not sent — 4th November');
  expect(sent[0].html).toMatch(/audience_empty/);
  expect(sent[0].html).toMatch(/Segment has &lt;no&gt; people/);
  expect(sent[0].html).toMatch(/#552/);
  expect(sent[0].html).toMatch(/raynatourslogo/);
});

test('alert: no recipients → nothing sent', async () => {
  let calls = 0;
  const n = await sendFailureAlert({ date: '2026-11-04', stage: 'create', reason: 'x', message: 'y', segmentId: 86, send: async () => { calls += 1; return { success: true }; }, env: {}, log: silent });
  expect(n).toBe(0);
  expect(calls).toBe(0);
});

test('alert: uses the daily email head — logo with its dark-mode swap, no customer footer', async () => {
  const { alertHtml } = await import('../../src/services/dailyOffer/alert.js');
  const html = alertHtml({ date: '2026-11-04', stage: 'create', reason: 'x', message: 'y', segmentId: 86 });
  expect(html).toContain('class="logo-light"');
  expect(html).toContain('raynatourslogo-dark');
  expect(html).not.toContain('unsubscribe');
  expect(html).not.toContain('PROMO_SECTIONS');
});
