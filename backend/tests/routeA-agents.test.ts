import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  query: vi.fn(),
  generateForSegment: vi.fn(), analyzeAndSuggest: vi.fn(), suggestFlowImprovements: vi.fn(), autoOptimize: vi.fn(),
  generateInsights: vi.fn(), autoOptimizeStrategies: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));
vi.mock('../src/services/AIAgents.js', () => ({
  Copywriter: { generateForSegment: m.generateForSegment },
  SegmentAssist: { analyzeAndSuggest: m.analyzeAndSuggest },
  FlowAssist: { suggestFlowImprovements: m.suggestFlowImprovements, autoOptimize: m.autoOptimize },
  AnalyticsInsights: { generateInsights: m.generateInsights, autoOptimizeStrategies: m.autoOptimizeStrategies },
}));

import agentsRouter from '../src/routes/agents.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', agentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { data?: unknown; error?: string }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.query.mockResolvedValue({ rows: [{ id: 1 }] });
});

describe('POST /copywriter/generate', () => {
  it('400 on empty body or missing channel', async () => {
    expect((await call('POST', '/copywriter/generate')).status).toBe(400);
    expect((await call('POST', '/copywriter/generate', { segmentId: '1' })).status).toBe(400);
    expect(m.generateForSegment).not.toHaveBeenCalled();
  });
  it('parses segmentId and forwards tone', async () => {
    m.generateForSegment.mockResolvedValue({ copy: 'hi' });
    const r = await call('POST', '/copywriter/generate', { segmentId: '7', channel: 'email', tone: 'fun' });
    expect(r.body).toEqual({ data: { copy: 'hi' } });
    expect(m.generateForSegment).toHaveBeenCalledWith(7, 'email', 'fun');
  });
  it('accepts a numeric segmentId (wrong-typed JSON number)', async () => {
    m.generateForSegment.mockResolvedValue({});
    await call('POST', '/copywriter/generate', { segmentId: 7, channel: 'email' });
    expect(m.generateForSegment).toHaveBeenCalledWith(7, 'email', undefined);
  });
  it('500 when the agent throws', async () => {
    m.generateForSegment.mockRejectedValue(new Error('anthropic down'));
    expect((await call('POST', '/copywriter/generate', { segmentId: '1', channel: 'email' })).status).toBe(500);
  });
});

describe('agent pass-throughs', () => {
  it('segment-assist, insights, auto-optimize', async () => {
    m.analyzeAndSuggest.mockResolvedValue('a');
    m.generateInsights.mockResolvedValue('b');
    m.autoOptimizeStrategies.mockResolvedValue('c');
    expect((await call('GET', '/segment-assist/analyze')).body).toEqual({ data: 'a' });
    expect((await call('GET', '/insights')).body).toEqual({ data: 'b' });
    expect((await call('POST', '/auto-optimize')).body).toEqual({ data: 'c' });
  });
  it('flow-assist parses journeyId', async () => {
    m.suggestFlowImprovements.mockResolvedValue([]);
    m.autoOptimize.mockResolvedValue({});
    await call('GET', '/flow-assist/suggest/12');
    await call('POST', '/flow-assist/auto-optimize/13');
    expect(m.suggestFlowImprovements).toHaveBeenCalledWith(12);
    expect(m.autoOptimize).toHaveBeenCalledWith(13);
  });
  // FIXED (was BUG) (src/routes/agents.ts:29): non-numeric journeyId becomes NaN and is sent to the AI agent instead of 400.
  it('flow-assist rejects a non-numeric journeyId with 400', async () => {
    m.suggestFlowImprovements.mockResolvedValue([]);
    expect((await call('GET', '/flow-assist/suggest/abc')).status).toBe(400);
  });
  it('500 when an agent throws', async () => {
    m.generateInsights.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/insights')).status).toBe(500);
  });
});

describe('GET /logs', () => {
  it('defaults limit 50 with no filter', async () => {
    const r = await call('GET', '/logs');
    expect(r.body).toEqual({ data: [{ id: 1 }] });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('WHERE 1=1 ORDER BY'), [50]);
  });
  it('binds agent_type as a parameter (injection-safe)', async () => {
    const evil = "x' OR 1=1 --";
    await call('GET', `/logs?agent_type=${encodeURIComponent(evil)}&limit=5`);
    expect(m.query).toHaveBeenCalledWith(expect.not.stringContaining(evil), [evil, 5]);
  });
  it('non-numeric limit falls back to 50', async () => {
    await call('GET', '/logs?limit=abc');
    expect(m.query).toHaveBeenCalledWith(expect.any(String), [50]);
  });
  it('500 on db error', async () => {
    m.query.mockRejectedValue(new Error('db'));
    expect((await call('GET', '/logs')).status).toBe(500);
  });
});
