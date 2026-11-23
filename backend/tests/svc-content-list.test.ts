// ContentService.getAll — light picker mode vs full list. Postgres is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));

import { ContentService } from '../src/services/ContentService.js';

beforeEach(() => { m.query.mockReset(); m.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('COUNT(*)') ? [{ total: '3' }] : [{ id: 1 }] })); });

describe('ContentService.getAll', () => {
  it('fields=light selects picker columns only — no body, body_plain or external payload', async () => {
    const r = await ContentService.getAll({ channel: 'email', search: 'welcome', fields: 'light', page: 2, limit: 50 });
    expect(r).toEqual({ data: [{ id: 1 }], total: 3, page: 2, limit: 50 });
    const [sql, params] = m.query.mock.calls.find(c => String(c[0]).includes('FROM content_templates') && !String(c[0]).includes('COUNT'))!;
    expect(String(sql)).toContain('variables');
    expect(String(sql)).not.toMatch(/body|external_payload|ai_prompt/);
    expect(String(sql)).toContain('(name ILIKE $2 OR subject ILIKE $2)');
    expect(params).toEqual(['email', '%welcome%', 50, 50]);
  });
  it('the default list still carries the truncated body for the editor', async () => {
    await ContentService.getAll({});
    const sql = String(m.query.mock.calls.find(c => !String(c[0]).includes('COUNT'))![0]);
    expect(sql).toContain('LEFT(body, 2000) AS body');
  });
});
