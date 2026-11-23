// ContactActivityService — merged, server-paged contact timeline. Postgres is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[] };
const m = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));

import ContactActivityService, { describe as describeRow, ACTIVITY_KINDS } from '../src/services/ContactActivityService.js';

beforeEach(() => { m.query.mockReset(); m.query.mockResolvedValue({ rows: [] }); });

describe('describe()', () => {
  const row = (kind: 'booking' | 'message' | 'website' | 'chat' | 'profile', payload: Record<string, unknown>) => ({ kind, at: new Date(), date_only: false, payload });
  it('emails: sent / opened / clicked / failed with journey and day', () => {
    const p = { subject: 'Hi there', journey_name: 'Welcome', day_number: 2 };
    expect(describeRow(row('message', { ...p, event: 'sent' }))).toEqual({ title: 'Sent email “Hi there”', sub: 'Welcome · day 2' });
    expect(describeRow(row('message', { ...p, event: 'opened' })).title).toBe('Opened email “Hi there”');
    expect(describeRow(row('message', { ...p, event: 'clicked' })).title).toBe('Clicked a link in “Hi there”');
    expect(describeRow(row('message', { ...p, event: 'failed', error: 'SMTP 535' }))).toEqual({ title: 'Email failed “Hi there”', sub: 'Welcome · day 2 · SMTP 535' });
    expect(describeRow(row('message', { event: 'sent', template_label: 'Day 1', journey_id: 9 }))).toEqual({ title: 'Sent email “Day 1”', sub: 'Journey 9' });
  });
  it('bookings: price, bill, travel date (dd/mm/yyyy) and cancelled flag', () => {
    expect(describeRow(row('booking', { type: 'Tour', service_name: 'Desert safari', bill_no: 'B1', selling_price: '640', is_cancel: '1', travel_date: '2026-10-05' })))
      .toEqual({ title: 'Booked Desert safari — AED 640', sub: 'Tour · Bill B1 · travel 05/10/2026 · Cancelled' });
    expect(describeRow(row('booking', { type: 'Hotel', selling_price: '0' }))).toEqual({ title: 'Booked hotel', sub: 'Hotel' });
  });
  it('website events are humanised with page and context', () => {
    expect(describeRow(row('website', { event_name: 'begin_checkout', page_url: 'https://x.com/dubai?a=1', page_title: 'Dubai', event_value: '250', device_type: 'mobile', city: 'Dubai', utm_source: 'email' })))
      .toEqual({ title: 'Begin checkout · Dubai', sub: '/dubai · AED 250 · mobile · Dubai · from email' });
    expect(describeRow(row('website', { event_name: 'page_view', page_url: 'not a url' })).title).toBe('Page view · not a url');
  });
  it('chats and profile milestones', () => {
    expect(describeRow(row('chat', { which: 'first', text: 'hello' }))).toEqual({ title: 'Chat started', sub: 'hello' });
    expect(describeRow(row('chat', { which: 'last', name: 'Ronald' }))).toEqual({ title: 'Latest chat message', sub: 'Ronald' });
    expect(describeRow(row('profile', { which: 'created', sources: 'rayna, chat' }))).toEqual({ title: 'Contact created', sub: 'From rayna, chat' });
    expect(describeRow(row('profile', {}))).toEqual({ title: 'Contact created', sub: undefined });
  });
  it('never produces undefined/NaN text for empty payloads', () => {
    for (const kind of ACTIVITY_KINDS) {
      const d = describeRow(row(kind, {}));
      expect(d.title).not.toMatch(/undefined|NaN|null/);
      expect(d.sub ?? '').not.toMatch(/undefined|NaN|null/);
    }
  });
});

describe('getActivity()', () => {
  it('runs a per-kind count and one page query, both SELECT-only and keyed by unified_id', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('GROUP BY kind')
      ? { rows: [{ kind: 'message', n: '31' }, { kind: 'chat', n: '2' }] }
      : { rows: [{ kind: 'chat', at: '2026-10-01T10:00:00.000Z', date_only: false, payload: { which: 'first', text: 'hi' } }] });
    const r = await ContactActivityService.getActivity(42, { page: 2, limit: 30 });
    expect(r).toMatchObject({ total: 33, page: 2, limit: 30, totalPages: 2, kinds: { message: 31, chat: 2 } });
    expect(r.items).toEqual([{ kind: 'chat', at: '2026-10-01T10:00:00.000Z', dateOnly: false, title: 'Chat started', sub: 'hi' }]);
    expect(m.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of m.query.mock.calls) {
      expect(/^\s*SELECT/i.test(sql)).toBe(true);
      expect(params?.[0]).toBe(42);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
    }
    const page = m.query.mock.calls.find(([sql]) => sql.includes('ORDER BY at DESC'));
    expect(page?.[1]).toEqual([42, 30, 30]);
    // every source table is in the union, each filtered by unified_id
    for (const t of ['email_send_log', 'rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_packages', 'rayna_others', 'gtm_events', 'chats', 'unified_contacts']) {
      expect(page?.[0]).toContain(t);
    }
  });
  it('kind filter is parameterised; unknown kind means all; limit is clamped to 100', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await ContactActivityService.getActivity(1, { kind: 'booking', limit: 5000, page: 0 });
    const page = m.query.mock.calls.find(([sql]) => sql.includes('ORDER BY at DESC'));
    expect(page?.[0]).toContain('AND kind = $4');
    expect(page?.[1]).toEqual([1, 100, 0, 'booking']);
    m.query.mockClear();
    await ContactActivityService.getActivity(1, { kind: "x' OR 1=1" });
    const page2 = m.query.mock.calls.find(([sql]) => sql.includes('ORDER BY at DESC'));
    expect(page2?.[0]).not.toContain('kind = $4');
    expect(page2?.[1]).toEqual([1, 30, 0]);
  });
});
