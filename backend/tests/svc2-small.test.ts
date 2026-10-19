import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  sendMail: vi.fn<(o: Record<string, unknown>) => Promise<{ messageId: string }>>(),
  createTransport: vi.fn(),
  isSegmentMember: vi.fn<(j: unknown, uid: unknown) => Promise<boolean>>(),
  nextStep: vi.fn<(n: unknown, e: unknown, id: string) => { nodeId: string; delayMs: number } | null>(),
  enter: vi.fn<(a: Record<string, unknown>) => Promise<number | null>>(),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query },
  query: m.query,
  transaction: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: m.createTransport },
}));
vi.mock('../src/services/GtmJourneyService.js', () => ({
  default: { _isSegmentMember: m.isSegmentMember, _nextStep: m.nextStep },
}));
vi.mock('../src/services/ContinuousJourneyService.js', () => ({
  default: { enter: m.enter },
}));

import SkipLogService from '../src/services/SkipLogService.js';
import { EmailTrackingService } from '../src/services/EmailTrackingService.js';
import ChatheadEmailChannel from '../src/services/channels/ChatheadEmailChannel.js';
import { sendJourneyEmail } from '../src/services/channels/JourneyEmailSender.js';
import GiveawayJourneyService from '../src/services/GiveawayJourneyService.js';

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.sendMail.mockReset();
  m.createTransport.mockReset();
  m.createTransport.mockReturnValue({ sendMail: m.sendMail });
  m.isSegmentMember.mockReset();
  m.nextStep.mockReset();
  m.enter.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.WELCOME_EMAILS = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GIVEAWAY_SMTP_HOST;
  delete process.env.GIVEAWAY_SMTP_USER;
  delete process.env.TRACKING_BASE_URL;
});

describe('SkipLogService', () => {
  it('inserts with normalised params', async () => {
    await SkipLogService.record({
      journeyId: 7, channel: 'email',
      eventRow: { event_id: 3, event_name: 'view', raw_payload: { itemName: 'Desert', pageUrl: 'https://p' } },
      itemId: 42, missing: ['ITEM_PRICE', 'CITY'],
    });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO journey_skip_log');
    expect(params).toEqual([7, 'email', 3, 'view', '42', 'Desert', 'ITEM_PRICE, CITY', 'https://p']);
  });
  it('defaults everything to null and empty missing to null', async () => {
    await SkipLogService.record();
    expect(m.query.mock.calls[0][1]).toEqual([null, null, null, null, null, null, null, null]);
  });
  it('string missing passes through', async () => {
    await SkipLogService.record({ missing: 'X' });
    expect(m.query.mock.calls[0][1]?.[6]).toBe('X');
  });
  it('never throws when db fails', async () => {
    m.query.mockRejectedValueOnce(new Error('down'));
    await expect(SkipLogService.record({ journeyId: 1 })).resolves.toBeUndefined();
  });
  it('csv escapes commas/quotes/newlines and orders header', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ skipped_at: 't', journey_id: 1, channel: 'email', item_name: 'a,"b"', missing_keys: 'x\ny', page_url: null }] });
    const csv = await SkipLogService.toCsv();
    const lines = csv.split('\n');
    expect(lines[0]).toBe(SkipLogService.header);
    expect(csv).toContain('"a,""b"""');
    expect(csv).toContain('"x\ny"');
    expect(csv.endsWith('\n')).toBe(true);
    expect(m.query.mock.calls[0][0]).toContain('ORDER BY skipped_at DESC');
  });
  it('csv with no rows is just header', async () => {
    expect(await SkipLogService.toCsv()).toBe(SkipLogService.columns.join(',') + '\n');
  });
});

describe('EmailTrackingService', () => {
  it('trackOpen updates message_log then campaign read_count with id', async () => {
    await EmailTrackingService.trackOpen(9);
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.query.mock.calls[0][0]).toContain('UPDATE message_log');
    expect(m.query.mock.calls[1][0]).toContain('read_count');
    expect(m.query.mock.calls[1][1]).toEqual([9]);
  });
  it('trackClick bumps utm clicks only when utm_campaign present', async () => {
    m.query.mockImplementation(async (sql) => sql.startsWith('SELECT campaign_id') ? { rows: [{ campaign_id: 5 }] } : { rows: [] });
    await EmailTrackingService.trackClick(1, 'https://x.com/?utm_campaign=summer');
    const utm = m.query.mock.calls.find(([s]) => s.includes('utm_tracking'));
    expect(utm?.[1]).toEqual([5, 'summer']);
  });
  it('trackClick tolerates invalid URL and no-utm URL', async () => {
    await EmailTrackingService.trackClick(1, 'not a url');
    await EmailTrackingService.trackClick(1, 'https://x.com/');
    expect(m.query.mock.calls.some(([s]) => s.includes('utm_tracking'))).toBe(false);
  });
  it('injectTracking adds pixel before </body> and wraps links except tracking/mailto', () => {
    process.env.TRACKING_BASE_URL = 'https://t';
    const out = EmailTrackingService.injectTracking('<body><a href="https://a.com/x?y=1">a</a><a href="https://t/api/track/z">b</a><a href="mailto:q@x">c</a></body>', 4);
    expect(out).toContain('<img src="https://t/api/track/open/4"');
    expect(out.indexOf('api/track/open')).toBeLessThan(out.indexOf('</body>'));
    expect(out).toContain(`https://t/api/track/click/4?url=${encodeURIComponent('https://a.com/x?y=1')}`);
    expect(out).toContain('href="https://t/api/track/z"');
    expect(out).toContain('href="mailto:q@x"');
  });
  it('injectTracking appends pixel without body', () => {
    process.env.TRACKING_BASE_URL = 'https://t';
    expect(EmailTrackingService.injectTracking('hi', 1).endsWith('alt="" />')).toBe(true);
  });
});

describe('ChatheadEmailChannel', () => {
  it('validates required fields without fetching', async () => {
    const r0 = await ChatheadEmailChannel.send({ subject: 's', html: 'h' });
    expect(r0.success).toBe(false);
    expect(r0.error).toContain('to');
    expect(await ChatheadEmailChannel.send({ to: 'a@b', html: 'h' })).toMatchObject({ success: false });
    expect(await ChatheadEmailChannel.send({ to: 'a@b', subject: 's' })).toMatchObject({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('allow-list skip', async () => {
    process.env.WELCOME_EMAILS = 'ok@x.com';
    const r = await ChatheadEmailChannel.send({ to: 'no@x.com', subject: 's', html: 'h' });
    expect(r).toMatchObject({ skipped: true, reason: 'not_in_allowlist' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('success path posts payload and reads message_id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'success', message_id: 'm1' }), { status: 200 }));
    const r = await ChatheadEmailChannel.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(r).toMatchObject({ success: true, externalId: 'm1', provider: 'aws-email' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { destinations: string[] };
    expect(body.destinations).toEqual(['a@b.com']);
  });
  it('non-JSON / rejected responses are failures with error text', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));
    const r = await ChatheadEmailChannel.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(r).toMatchObject({ success: false, raw: 'oops', error: 'HTTP 500' });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'error', msg: 'bad' }), { status: 200 }));
    expect(await ChatheadEmailChannel.send({ to: 'a@b.com', subject: 's', html: 'h' })).toMatchObject({ success: false, error: 'bad' });
  });
  it('network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONN'));
    const r = await ChatheadEmailChannel.send({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('ECONN');
  });
});

describe('JourneyEmailSender', () => {
  it('default credential goes via AWS channel', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'success', id: 'x' }), { status: 200 }));
    const r = await sendJourneyEmail({ to: 'a@b.com', subject: 's', html: 'h' });
    expect(r.success).toBe(true);
    expect(m.createTransport).not.toHaveBeenCalled();
  });
  it('giveaway without config fails, with config uses SMTP once (cached transport)', async () => {
    const r1 = await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@b.com', subject: 's', html: 'h' });
    expect(r1).toMatchObject({ success: false, provider: 'giveaway-smtp' });
    process.env.GIVEAWAY_SMTP_HOST = 'smtp.local';
    process.env.GIVEAWAY_SMTP_USER = 'u';
    m.sendMail.mockResolvedValue({ messageId: 'g1' });
    const r2 = await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@b.com', subject: 's', html: 'h' });
    expect(r2).toMatchObject({ success: true, externalId: 'g1' });
    m.sendMail.mockRejectedValue(new Error('smtp down'));
    const r3 = await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@b.com', subject: 's', html: 'h' });
    expect(r3).toMatchObject({ success: false, error: 'smtp down' });
    expect(m.createTransport).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('giveaway respects allow-list', async () => {
    process.env.WELCOME_EMAILS = 'z@z.com';
    expect(await sendJourneyEmail({ emailCredential: 'giveaway', to: 'a@b.com', subject: 's', html: 'h' })).toMatchObject({ skipped: true });
  });
});

describe('GiveawayJourneyService.onEvent', () => {
  const journey = (id: number, nodes: Array<{ id: string; type: string }>) => ({ journey_id: id, nodes, edges: [] });
  it('returns 0 without type/uid and does not query', async () => {
    expect(await GiveawayJourneyService.onEvent({ giveawayType: '', unifiedId: 1, eventId: 'e' })).toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });
  it('enters only segment members, counts handled even on idempotent null', async () => {
    m.query.mockResolvedValue({ rows: [
      journey(1, [{ id: 't', type: 'trigger' }, { id: 'a', type: 'action' }]),
      journey(2, [{ id: 't', type: 'trigger' }]),
      journey(3, [{ id: 'a3', type: 'action' }]),
    ] });
    m.isSegmentMember.mockImplementation(async (j) => (j as { journey_id: number }).journey_id !== 2);
    m.nextStep.mockReturnValue({ nodeId: 'a', delayMs: 5000 });
    m.enter.mockResolvedValueOnce(11).mockResolvedValueOnce(null);
    const n = await GiveawayJourneyService.onEvent({ giveawayType: 'winner', unifiedId: 9, eventId: 'ev1' });
    expect(n).toBe(2);
    expect(m.query.mock.calls[0][1]).toEqual(['winner']);
    expect(m.enter.mock.calls[0][0]).toMatchObject({ journeyId: 1, firstNodeId: 'a', entryDelayMs: 5000, itemId: 'ev1' });
    expect(m.enter.mock.calls[1][0]).toMatchObject({ journeyId: 3, firstNodeId: 'a3', entryDelayMs: 0 });
  });
  it('errors in one journey do not stop others; no first node is skipped', async () => {
    m.query.mockResolvedValue({ rows: [journey(1, [{ id: 'a', type: 'action' }]), journey(2, [{ id: 'x', type: 'wait' }]), journey(3, [{ id: 'b', type: 'action' }])] });
    m.isSegmentMember.mockResolvedValue(true);
    m.enter.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(5);
    expect(await GiveawayJourneyService.onEvent({ giveawayType: 'loser', unifiedId: 1, eventId: undefined })).toBe(1);
    expect(m.enter.mock.calls[1][0]).toMatchObject({ itemId: '_noitem' });
  });
});
