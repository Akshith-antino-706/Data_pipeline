import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  TABLES: {
    bookings: { label: 'Tour Bookings', group: 'g1' },
    visas: { label: 'Visa Bookings', group: 'g2' },
  } as Record<string, { label: string; group: string }>,
  getRecordCounts: vi.fn(), getSyncStatus: vi.fn(), getPreview: vi.fn(), generateCSV: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/DailyReportService.js', () => ({ default: m }));

import router from '../src/routes/dailyReport.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/dr', router);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dr`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  for (const f of [m.getRecordCounts, m.getSyncStatus, m.getPreview, m.generateCSV]) f.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
const get = (p: string): Promise<Response> => fetch(`${base}${p}`);
const R = 'from=2024-01-01&to=2024-01-31';

describe('date validation (via /counts)', () => {
  it.each([
    ['', 'missing both'], ['from=2024-01-01', 'missing to'], ['to=2024-01-01', 'missing from'],
    ['from=abc&to=2024-01-01', 'invalid'], ["from=2024-01-01'--&to=x", 'injection'],
    ['from=2024-02-01&to=2024-01-01', 'reversed'], ['from=2024-01-01&to=2024-06-01', '>90 days'],
  ])('400 for %s (%s)', async (qs) => {
    expect((await get(`/counts?${qs}`)).status).toBe(400);
    expect(m.getRecordCounts).not.toHaveBeenCalled();
  });
  it('accepts exactly 90 days', async () => {
    m.getRecordCounts.mockResolvedValue({ bookings: { totalRows: 0 }, visas: { totalRows: 0 } });
    m.getSyncStatus.mockResolvedValue({});
    expect((await get('/counts?from=2024-01-01&to=2024-03-31')).status).toBe(200);
  });
});

describe('GET /counts', () => {
  it('aggregates totals across tables', async () => {
    m.getRecordCounts.mockResolvedValue({
      bookings: { totalRows: 2, totalBills: 1, totalSales: 100 },
      visas: { totalRows: 3, totalBills: 2, totalSales: 50 },
    });
    m.getSyncStatus.mockResolvedValue({ bookings: { at: 'x' } });
    const body = await (await get(`/counts?${R}`)).json() as {
      totalRows: number; totalBills: number; totalSales: number; tables: Record<string, { sync: unknown; label: string }>;
    };
    expect(body.totalRows).toBe(5);
    expect(body.totalBills).toBe(3);
    expect(body.totalSales).toBe(150);
    expect(body.tables.bookings.sync).toEqual({ at: 'x' });
    expect(body.tables.visas.sync).toBeNull();
    expect(m.getRecordCounts).toHaveBeenCalledWith('2024-01-01', '2024-01-31');
  });
  it('500s when the service throws', async () => {
    m.getRecordCounts.mockRejectedValue(new Error('boom'));
    m.getSyncStatus.mockResolvedValue({});
    expect((await get(`/counts?${R}`)).status).toBe(500);
  });
});

describe('table whitelist', () => {
  it('preview/download reject unknown / injection table names', async () => {
    for (const t of ['users', encodeURIComponent('bookings; DROP TABLE x'), '__proto__']) {
      expect((await get(`/preview/${t}?${R}`)).status, t).toBe(400);
      expect((await get(`/download/${t}?${R}`)).status, t).toBe(400);
    }
    expect(m.getPreview).not.toHaveBeenCalled();
    expect(m.generateCSV).not.toHaveBeenCalled();
  });
  it('preview spreads service result', async () => {
    m.getPreview.mockResolvedValue({ rows: [1] });
    expect(await (await get(`/preview/bookings?${R}`)).json()).toEqual({ success: true, rows: [1] });
  });
  it('preview validates dates after the table', async () => {
    expect((await get('/preview/bookings')).status).toBe(400);
  });
  it('download returns CSV with filename', async () => {
    m.generateCSV.mockResolvedValue('a,b');
    const r = await get(`/download/bookings?${R}`);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="bookings_2024-01-01_to_2024-01-31.csv"');
    expect(await r.text()).toBe('a,b');
  });
  it('download 500s on error', async () => {
    m.generateCSV.mockRejectedValue(new Error('x'));
    expect((await get(`/download/bookings?${R}`)).status).toBe(500);
  });
});

describe('GET /download-all', () => {
  it('400 on bad dates', async () => {
    expect((await get('/download-all')).status).toBe(400);
  });
  it('streams a zip containing one CSV per table', async () => {
    m.generateCSV.mockResolvedValue('a,b');
    const r = await get(`/download-all?${R}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.toString('latin1')).toContain('Tour_Bookings_2024-01-01_to_2024-01-31.csv');
    expect(m.generateCSV).toHaveBeenCalledTimes(2);
  });
});
