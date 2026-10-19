import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  bt: {
    listTemplates: vi.fn(), getTemplate: vi.fn(), preview: vi.fn(), render: vi.fn(), renderSubject: vi.fn(), clearCache: vi.fn(),
    listSegmentTemplates: vi.fn(), getSegmentConfig: vi.fn(), previewForSegment: vi.fn(), renderForSegment: vi.fn(),
  },
  create: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/BaseTemplateService.js', () => ({ BaseTemplateService: m.bt }));
vi.mock('../src/services/ContentService.js', () => ({ ContentService: { create: m.create } }));

import btRouter from '../src/routes/baseTemplates.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', btRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: unknown; error?: string; total?: number; message?: string }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => { for (const f of Object.values(m.bt)) f.mockReset(); m.create.mockReset(); });

const meta = { id: 'welcome', name: 'Welcome', html: '<p/>', subject: 'Hi', variables: ['customer_name'] };

describe('base templates', () => {
  it('GET / lists; 500 with message when service throws', async () => {
    m.bt.listTemplates.mockReturnValue([{ id: 'a' }]);
    expect((await call('GET', '/')).body).toEqual({ success: true, data: [{ id: 'a' }] });
    m.bt.listTemplates.mockImplementation(() => { throw new Error('fs'); });
    expect(await call('GET', '/')).toEqual({ status: 500, body: { success: false, error: 'fs' } });
  });
  it('GET /:id 404 / 200; path traversal id is passed as a single param', async () => {
    m.bt.getTemplate.mockReturnValue(null);
    expect((await call('GET', `/${encodeURIComponent('../../etc/passwd')}`)).status).toBe(404);
    expect(m.bt.getTemplate).toHaveBeenCalledWith('../../etc/passwd');
    m.bt.getTemplate.mockReturnValue(meta);
    expect((await call('GET', '/welcome')).body.data).toEqual(meta);
  });
  it('GET /:id/preview wraps html; 500 on throw', async () => {
    m.bt.preview.mockReturnValue('<x/>');
    expect((await call('GET', '/welcome/preview')).body).toEqual({ success: true, data: { html: '<x/>' } });
    m.bt.preview.mockImplementation(() => { throw new Error('Unknown template'); });
    expect((await call('GET', '/nope/preview')).status).toBe(500);
  });
  it('POST /:id/render passes the body to render + renderSubject', async () => {
    m.bt.render.mockReturnValue('<h/>');
    m.bt.renderSubject.mockReturnValue('S');
    const r = await call('POST', '/welcome/render', { customer_name: 'A' });
    expect(r.body).toEqual({ success: true, data: { html: '<h/>', subject: 'S' } });
    expect(m.bt.render).toHaveBeenCalledWith('welcome', { customer_name: 'A' });
  });
  it('POST /:id/use 404 when template missing', async () => {
    m.bt.getTemplate.mockReturnValue(null);
    expect((await call('POST', '/x/use', {})).status).toBe(404);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('POST /:id/use without data uses the raw template and default CTA', async () => {
    m.bt.getTemplate.mockReturnValue(meta);
    m.create.mockResolvedValue({ id: 5 });
    const r = await call('POST', '/welcome/use', { name: 'Mine' });
    expect(r.body).toEqual({ success: true, data: { id: 5 } });
    expect(m.create).toHaveBeenCalledWith({
      name: 'Mine', channel: 'email', subject: 'Hi', body: '<p/>', variables: ['customer_name'],
      ctaUrl: 'https://www.raynatours.com', ctaText: 'Book Now',
    });
    expect(m.bt.render).not.toHaveBeenCalled();
  });
  it('POST /:id/use with data renders and maps cta_url → ctaUrl', async () => {
    m.bt.getTemplate.mockReturnValue(meta);
    m.bt.render.mockReturnValue('<r/>');
    m.bt.renderSubject.mockReturnValue('RS');
    m.create.mockResolvedValue({});
    await call('POST', '/welcome/use', { data: { cta_url: 'https://x.test' } });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ body: '<r/>', subject: 'RS', ctaUrl: 'https://x.test', name: expect.stringContaining('Welcome — ') as string }));
  });
  it('POST /:id/use → 500 when ContentService.create throws', async () => {
    m.bt.getTemplate.mockReturnValue(meta);
    m.create.mockRejectedValue(new Error('db'));
    expect(await call('POST', '/welcome/use', {})).toEqual({ status: 500, body: { success: false, error: 'db' } });
  });
  it('POST /clear-cache', async () => {
    expect((await call('POST', '/clear-cache')).body).toEqual({ success: true, message: 'Template cache cleared' });
    expect(m.bt.clearCache).toHaveBeenCalledTimes(1);
  });
});

describe('segment templates', () => {
  it('GET /segments/all returns total', async () => {
    m.bt.listSegmentTemplates.mockReturnValue([{}, {}]);
    expect((await call('GET', '/segments/all')).body).toEqual({ success: true, data: [{}, {}], total: 2 });
  });
  it('GET /segments/:name decodes names with spaces; 404 when unknown', async () => {
    m.bt.getSegmentConfig.mockReturnValue(null);
    expect((await call('GET', `/segments/${encodeURIComponent('Lost Customers')}`)).status).toBe(404);
    expect(m.bt.getSegmentConfig).toHaveBeenCalledWith('Lost Customers');
  });
  it('GET /segments/:name with a malformed percent-encoding does not 200', async () => {
    const r = await fetch(`${base}/segments/%E0%A4%A`);
    await r.text();
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it('POST /segments/:name/render forwards customerName and products', async () => {
    m.bt.renderForSegment.mockReturnValue({ html: 'h', subject: 's' });
    const r = await call('POST', '/segments/VIP/render', { customerName: 'A', products: [] });
    expect(r.body.data).toEqual({ html: 'h', subject: 's' });
    expect(m.bt.renderForSegment).toHaveBeenCalledWith('VIP', { customerName: 'A', products: [] });
  });
  it('POST /segments/:name/render with empty body passes undefineds', async () => {
    m.bt.renderForSegment.mockReturnValue({});
    await call('POST', '/segments/VIP/render');
    expect(m.bt.renderForSegment).toHaveBeenCalledWith('VIP', { customerName: undefined, products: undefined });
  });
  it('POST /segments/:name/use 404 for unknown segment, 200 otherwise', async () => {
    m.bt.previewForSegment.mockReturnValue({ html: 'h', subject: 's' });
    m.bt.getSegmentConfig.mockReturnValue(null);
    expect((await call('POST', '/segments/X/use', {})).status).toBe(404);
    m.bt.getSegmentConfig.mockReturnValue({ cta_url: 'https://c.test' });
    m.create.mockResolvedValue({ id: 1 });
    const r = await call('POST', '/segments/X/use', {});
    expect(r.status).toBe(200);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'X — Email Template', ctaUrl: 'https://c.test', ctaText: 'Book Now' }));
  });
  // BUG (src/routes/baseTemplates.ts:142-144): previewForSegment runs BEFORE the getSegmentConfig
  // existence check, so an unknown segment that makes the preview throw returns 500 instead of 404.
  it.fails('POST /segments/:name/use returns 404 (not 500) for an unknown segment whose preview throws', async () => {
    m.bt.previewForSegment.mockImplementation(() => { throw new Error('no config'); });
    m.bt.getSegmentConfig.mockReturnValue(null);
    expect((await call('POST', '/segments/Nope/use', {})).status).toBe(404);
  });
});
