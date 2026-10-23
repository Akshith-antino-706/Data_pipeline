import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  cs: { getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), approve: vi.fn(), reject: vi.fn(), delete: vi.fn() },
  renderPreview: vi.fn(),
  getDailyAITemplate: vi.fn(),
  loadVisaCatalog: vi.fn(),
  buildFallbackRanking: vi.fn(),
  buildDay1WelcomeData: vi.fn(),
  renderDay1Welcome: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/ContentService.js', () => ({ ContentService: m.cs }));
vi.mock('../src/services/EmailRenderer.js', () => ({ default: { renderPreview: m.renderPreview } }));
vi.mock('../src/services/JourneyService.js', () => ({ getDailyAITemplate: m.getDailyAITemplate, default: {} }));
vi.mock('../src/services/Day1WelcomeRankingService.js', () => ({ _internals: { loadVisaCatalog: m.loadVisaCatalog, buildFallbackRanking: m.buildFallbackRanking } }));
vi.mock('../src/services/Day1WelcomeDataService.js', () => ({
  buildDay1WelcomeData: m.buildDay1WelcomeData,
  _internals: { HOLIDAY_DESTINATIONS: {}, CRUISE_DESTINATIONS: {}, ACTIVITY_DESTINATIONS: {} },
}));
vi.mock('../src/services/Day1WelcomeRenderer.js', () => ({ renderDay1Welcome: m.renderDay1Welcome }));

import contentRouter from '../src/routes/content.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', contentRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: { html?: string; subject?: string; source?: string } | unknown; error?: string }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => {
  for (const f of Object.values(m.cs)) f.mockReset();
  for (const f of [m.renderPreview, m.getDailyAITemplate, m.loadVisaCatalog, m.buildFallbackRanking, m.buildDay1WelcomeData, m.renderDay1Welcome]) f.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /templates', () => {
  it('parses paging and spreads the result', async () => {
    m.cs.getAll.mockResolvedValue({ templates: [], total: 0 });
    const r = await call('GET', '/templates?channel=email&status=draft&search=x&page=2&limit=abc');
    expect(r.body).toEqual({ success: true, templates: [], total: 0 });
    expect(m.cs.getAll).toHaveBeenCalledWith({ channel: 'email', status: 'draft', search: 'x', page: 2, limit: 20 });
  });
  it('fields=light is forwarded (anything else is ignored) and limit is capped at 200', async () => {
    m.cs.getAll.mockResolvedValue({});
    await call('GET', '/templates?fields=light&channel=sms&limit=5000');
    expect(m.cs.getAll).toHaveBeenCalledWith({ channel: 'sms', status: undefined, search: undefined, page: 1, limit: 200, fields: 'light' });
    await call('GET', '/templates?fields=everything');
    expect(m.cs.getAll).toHaveBeenLastCalledWith(expect.not.objectContaining({ fields: expect.anything() }));
  });
  it('passes an injection search string through unchanged (service must bind it)', async () => {
    m.cs.getAll.mockResolvedValue({});
    await call('GET', `/templates?search=${encodeURIComponent("%' OR 1=1--")}`);
    expect(m.cs.getAll).toHaveBeenCalledWith(expect.objectContaining({ search: "%' OR 1=1--" }));
  });
  it('500 on error', async () => {
    m.cs.getAll.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/templates')).status).toBe(500);
  });
});

describe('GET /templates/:id', () => {
  it('404 / 200', async () => {
    m.cs.getById.mockResolvedValue(null);
    expect((await call('GET', '/templates/abc')).status).toBe(404);
    expect(m.cs.getById).toHaveBeenCalledWith('abc');
    m.cs.getById.mockResolvedValue({ id: 1 });
    expect((await call('GET', '/templates/1')).body).toEqual({ success: true, data: { id: 1 } });
  });
});

describe('GET /templates/:id/preview', () => {
  it('404 when missing', async () => {
    m.cs.getById.mockResolvedValue(null);
    expect((await call('GET', '/templates/1/preview')).status).toBe(404);
  });
  it('non-email template returns raw body', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'whatsapp', body: 'hi', name: 'Day 1 - x' });
    expect((await call('GET', '/templates/1/preview')).body).toEqual({ success: true, data: { html: 'hi' } });
  });
  it('email template without a Day N name returns body or placeholder', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'email', body: null, name: 'Promo' });
    expect((await call('GET', '/templates/1/preview')).body).toEqual({ success: true, data: { html: '<p>No content</p>' } });
  });
  it('Day 1 template uses the file renderer', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'email', body: '', name: 'Day 1 - Welcome' });
    m.loadVisaCatalog.mockResolvedValue([{ key: 'uae' }]);
    m.buildFallbackRanking.mockReturnValue({});
    m.buildDay1WelcomeData.mockResolvedValue({});
    m.renderDay1Welcome.mockReturnValue('<h1>day1</h1>');
    expect((await call('GET', '/templates/1/preview')).body).toEqual({ success: true, data: { html: '<h1>day1</h1>' } });
  });
  it('500 when the Day renderer fails', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'email', body: '', name: 'Day 1 - Welcome' });
    m.loadVisaCatalog.mockRejectedValue(new Error('db'));
    const r = await call('GET', '/templates/1/preview');
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Day 1 renderer failed');
  });
  it('unknown day (Day 9) → 500 renderer failed', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'email', body: '', name: 'Day 9 - x' });
    expect((await call('GET', '/templates/1/preview')).status).toBe(500);
  });
});

describe('GET /templates/:id/preview-ai', () => {
  it('404 / 400 / 200', async () => {
    m.cs.getById.mockResolvedValue(null);
    expect((await call('GET', '/templates/1/preview-ai')).status).toBe(404);
    m.cs.getById.mockResolvedValue({ id: 1 });
    m.getDailyAITemplate.mockResolvedValue(null);
    expect((await call('GET', '/templates/1/preview-ai')).status).toBe(400);
    m.getDailyAITemplate.mockResolvedValue({ html: '<x/>', subject: 's', source: 'claude', day: 1 });
    const r = await call('GET', '/templates/1/preview-ai');
    expect(r.body.data).toEqual({ html: '<x/>', subject: 's', source: 'claude', day: 1 });
    expect(m.getDailyAITemplate).toHaveBeenLastCalledWith(1);
  });
});

describe('POST /templates/:id/preview', () => {
  it('uses EmailRenderer with variables, defaulting to {}', async () => {
    m.cs.getById.mockResolvedValue({ channel: 'email', name: 'Promo' });
    m.renderPreview.mockResolvedValue({ html: 'h', subject: 's', extra: 1 });
    let r = await call('POST', '/templates/4/preview', { variables: { offer_tag: '20%' } });
    expect(r.body).toEqual({ success: true, data: { html: 'h', subject: 's' } });
    expect(m.renderPreview).toHaveBeenLastCalledWith(4, { offer_tag: '20%' });
    r = await call('POST', '/templates/4/preview');
    expect(m.renderPreview).toHaveBeenLastCalledWith(4, {});
  });
  it('404 when missing; 500 when renderer throws', async () => {
    m.cs.getById.mockResolvedValue(null);
    expect((await call('POST', '/templates/4/preview', {})).status).toBe(404);
    m.cs.getById.mockResolvedValue({ channel: 'email', name: 'Promo' });
    m.renderPreview.mockRejectedValue(new Error('bad'));
    expect((await call('POST', '/templates/4/preview', {})).status).toBe(500);
  });
});

describe('CRUD', () => {
  it('POST /templates → 201', async () => {
    m.cs.create.mockResolvedValue({ id: 1 });
    const r = await call('POST', '/templates', { name: 'n' });
    expect(r.status).toBe(201);
    expect(m.cs.create).toHaveBeenCalledWith({ name: 'n' });
  });
  it('POST /templates with service validation error → 500', async () => {
    m.cs.create.mockRejectedValue(new Error('name required'));
    expect((await call('POST', '/templates')).status).toBe(500);
  });
  it('PUT 404 / 200', async () => {
    m.cs.update.mockResolvedValue(null);
    expect((await call('PUT', '/templates/1', {})).status).toBe(404);
    m.cs.update.mockResolvedValue({ id: 1 });
    expect((await call('PUT', '/templates/1', { name: 'x' })).status).toBe(200);
  });
  it('approve defaults approvedBy to system', async () => {
    m.cs.approve.mockResolvedValue({ id: 1 });
    await call('POST', '/templates/1/approve', {});
    expect(m.cs.approve).toHaveBeenLastCalledWith('1', 'system');
    await call('POST', '/templates/1/approve', { approvedBy: 'bob' });
    expect(m.cs.approve).toHaveBeenLastCalledWith('1', 'bob');
  });
  it('approve / reject / delete → 404 when not found', async () => {
    m.cs.approve.mockResolvedValue(null);
    m.cs.reject.mockResolvedValue(null);
    m.cs.delete.mockResolvedValue(false);
    expect((await call('POST', '/templates/1/approve', {})).status).toBe(404);
    expect((await call('POST', '/templates/1/reject')).status).toBe(404);
    expect((await call('DELETE', '/templates/1')).status).toBe(404);
  });
  it('DELETE success', async () => {
    m.cs.delete.mockResolvedValue(true);
    expect((await call('DELETE', '/templates/1')).body).toEqual({ success: true });
  });
});
