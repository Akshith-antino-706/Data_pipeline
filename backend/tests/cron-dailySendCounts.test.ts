import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));

import { runDailySendCounts } from '../src/crons/dailySendCounts.js';

const sqls = (): string[] => mockQuery.mock.calls.map(c => String(c[0]));
const WRITE = /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|COPY)\b/i;

beforeEach(() => {
  mockQuery.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runDailySendCounts', () => {
  it('writes only to daily_send_counts and only reads the send logs', async () => {
    let dayN = 0;
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('to_char(day')) return Promise.resolve({ rows: [] });
      if (sql.includes("AS day") && !sql.includes('daily_send_counts')) { dayN += 1; return Promise.resolve({ rows: [{ day: `2026-10-${String(20 - dayN).padStart(2, '0')}` }] }); }
      return Promise.resolve({ rows: [{ n: '5' }] });
    });
    const r = await runDailySendCounts({ days: 3 });
    expect(r).toMatchObject({ checked: 3, written: 3, skipped: 0 });
    for (const sql of sqls()) {
      if (WRITE.test(sql)) {
        expect(sql).toMatch(/INSERT INTO daily_send_counts/);
        expect(sql).toMatch(/ON CONFLICT \(day, channel\) DO UPDATE/);
        expect(sql).not.toMatch(/\b(UPDATE|DELETE)\s+(email_send_log|whatsapp_send_log|sms_send_log)/i);
      }
    }
    const writes = sqls().filter(s => WRITE.test(s));
    expect(writes).toHaveLength(3);
  });

  it('never writes today (starts at 1 day ago) and skips days already complete', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('to_char(day')) return Promise.resolve({ rows: [{ day: '2026-10-17' }] });
      if (sql.includes("AS day")) {
        const k = /INTERVAL '(\d+) days'/.exec(sql)?.[1];
        return Promise.resolve({ rows: [{ day: k === '1' ? '2026-10-18' : '2026-10-17' }] });
      }
      return Promise.resolve({ rows: [{ n: '1' }] });
    });
    const r = await runDailySendCounts({ days: 2 });
    expect(r).toMatchObject({ written: 1, skipped: 1 });
    expect(sqls().some(s => /INTERVAL '0 days'/.test(s) && s.includes('to_char'))).toBe(false);
  });

  it('missing table is reported and nothing else runs', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('relation "daily_send_counts" does not exist'), { code: '42P01' }));
    const r = await runDailySendCounts();
    expect(r.error).toMatch(/run migration 118/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
