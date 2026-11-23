import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), render: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));
vi.mock('../src/services/channels/EmailChannel.js', () => ({ EmailChannel: { send: m.send } }));
vi.mock('../src/services/EmailRenderer.js', () => ({ default: { render: m.render } }));

import e2eRouter from '../src/routes/testE2E.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', e2eRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; results?: Array<Record<string, unknown>>; generated?: number; links?: Array<Record<string, unknown>>; error?: string }
async function call(method: string, p: string): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method });
  return { status: r.status, body: (await r.json()) as Body };
}
type Handler = (sql: string) => { rows: unknown[]; rowCount?: number };
function db(h: Handler): void { m.query.mockImplementation((sql: string) => Promise.resolve(h(sql))); }

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  db(() => ({ rows: [], rowCount: 0 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /send-journey-emails', () => {
  it('reports "not found" for each of the 4 test users when contacts are missing, sending nothing', async () => {
    const r = await call('POST', '/send-journey-emails');
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(4);
    expect(r.body.results?.every(x => x.error === 'not found')).toBe(true);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('reports "no email template" when the segment has none', async () => {
    db(sql => (sql.includes('FROM unified_contacts') ? { rows: [{ booking_status: 'VIP' }] } : { rows: [] }));
    const r = await call('POST', '/send-journey-emails');
    expect(r.body.results?.[0]).toEqual({ user: 'Akshith Kumar', segment: 'VIP', error: 'no email template' });
  });
  it('renders + sends with the default UTM link when there is no campaign', async () => {
    db(sql => {
      if (sql.includes('FROM unified_contacts')) return { rows: [{ booking_status: 'VIP' }] };
      if (sql.includes('FROM content_templates')) return { rows: [{ id: 5, name: 'T', html_template_id: 2 }] };
      return { rows: [] };
    });
    m.render.mockResolvedValue({ subject: 'S', html: '<h/>', plainText: 't' });
    m.send.mockResolvedValue({ success: true, externalId: 'x1' });
    const r = await call('POST', '/send-journey-emails');
    expect(m.send).toHaveBeenCalledTimes(4);
    expect(m.render).toHaveBeenCalledWith(5, 1369472, { utm_link: 'https://www.raynatours.com/activities' });
    expect(r.body.results?.[0]).toEqual(expect.objectContaining({ sent: true, messageId: 'x1', htmlTemplate: 'YES' }));
  });
  it('500 when the renderer throws', async () => {
    db(sql => {
      if (sql.includes('FROM unified_contacts')) return { rows: [{ booking_status: 'VIP' }] };
      if (sql.includes('FROM content_templates')) return { rows: [{ id: 5 }] };
      return { rows: [] };
    });
    m.render.mockRejectedValue(new Error('render'));
    expect((await call('POST', '/send-journey-emails')).status).toBe(500);
  });
});

describe('POST /enroll-users', () => {
  it('marks NEW vs ALREADY_ENROLLED from rowCount', async () => {
    let n = 0;
    db(sql => {
      if (sql.includes('FROM unified_contacts')) return { rows: [{ booking_status: 'VIP' }] };
      if (sql.includes('FROM journey_flows')) return { rows: [{ journey_id: 1, name: 'J' }] };
      if (sql.includes('INSERT INTO journey_entries')) return { rows: [], rowCount: n++ === 0 ? 1 : 0 };
      return { rows: [] };
    });
    const r = await call('POST', '/enroll-users');
    expect(r.body.results?.map(x => x.enrolled)).toEqual(['NEW', 'ALREADY_ENROLLED', 'ALREADY_ENROLLED', 'ALREADY_ENROLLED']);
  });
  it('reports "no journey"', async () => {
    db(sql => (sql.includes('FROM unified_contacts') ? { rows: [{ booking_status: 'X' }] } : { rows: [] }));
    expect((await call('POST', '/enroll-users')).body.results?.[0]?.error).toBe('no journey');
  });
  it('500 on db error', async () => {
    m.query.mockRejectedValue(new Error('db'));
    expect((await call('POST', '/enroll-users')).status).toBe(500);
  });
});

describe('GET /status and POST /generate-utm-links', () => {
  it('status aggregates per user', async () => {
    const r = await call('GET', '/status');
    expect(r.body.results).toHaveLength(4);
    expect(r.body.results?.[0]).toEqual({ journeys: [], utmClicks: [], productAffinity: [], recentEvents: [] });
  });
  it('generate-utm-links counts only inserted links with unguessable 16-hex tokens', async () => {
    db(sql => {
      if (sql.includes('FROM unified_contacts')) return { rows: [{ booking_status: 'VIP' }] };
      if (sql.includes('FROM campaigns')) return { rows: [{ id: 1, name: 'C', channel: 'email', utm_id: 3, full_url: null }] };
      if (sql.includes('INSERT INTO user_utm_links')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    const r = await call('POST', '/generate-utm-links');
    expect(r.body.generated).toBe(4);
    const tokens = (r.body.links ?? []).map(l => l.token);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(tokens).size).toBe(4);
  });
  it('generate-utm-links with no contacts generates nothing', async () => {
    expect((await call('POST', '/generate-utm-links')).body).toEqual({ success: true, generated: 0, links: [] });
  });
});
