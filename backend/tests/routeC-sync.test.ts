// sync.ts (BigQuery/phpAdmin) and mysqlSync.ts trigger routes. Services and child_process
// are mocked — no real process is ever spawned.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Router } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once, EventEmitter } from 'node:events';

const { bq, phpRun, spawnMock } = vi.hoisted(() => ({
  bq: {
    getSyncStatus: vi.fn<() => Promise<Record<string, unknown>>>(),
    syncAll: vi.fn<() => Promise<Record<string, unknown>>>(),
    rebuildUserProfiles: vi.fn<() => Promise<number>>(),
    linkToCustomers: vi.fn<() => Promise<Record<string, unknown>>>(),
  },
  phpRun: vi.fn<(o: { triggeredBy: string }) => Promise<{ status: string; [k: string]: unknown }>>(),
  spawnMock: vi.fn<(cmd: string, args: string[], opts: Record<string, unknown>) => unknown>(),
}));
vi.mock('../src/services/BigQuerySyncService.js', () => ({ default: bq }));
vi.mock('../src/services/PhpAdminWeeklySync.js', () => ({ runPhpAdminSync: phpRun }));
vi.mock('../src/services/MySQLSyncService.js', () => ({ default: {} }));
vi.mock('child_process', () => ({ spawn: spawnMock, default: { spawn: spawnMock } }));

import syncRouter from '../src/routes/sync.js';
import mysqlSyncRouter from '../src/routes/mysqlSync.js';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn<(sig?: string) => boolean>(() => true);
}
type Script = (c: FakeChild) => void;
let script: Script = c => { c.emit('close', 0); };
let lastChild: FakeChild | null = null;

const servers: Server[] = [];
async function mount(router: Router): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  const s = app.listen(0, '127.0.0.1');
  servers.push(s);
  await once(s, 'listening');
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
let syncBase = '';
let mysqlBase = '';
beforeAll(async () => { syncBase = await mount(syncRouter); mysqlBase = await mount(mysqlSyncRouter); });
afterAll(() => { for (const s of servers) s.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  script = c => { c.emit('close', 0); };
  spawnMock.mockImplementation(() => {
    const c = new FakeChild();
    lastChild = c;
    setImmediate(() => script(c));
    return c;
  });
});

interface Body { success?: boolean; error?: string; exitCode?: number | null; stdout?: string; stderr?: string; [k: string]: unknown }
async function call(url: string, method = 'GET', raw?: string): Promise<{ status: number; body: Body }> {
  const init: RequestInit = { method };
  if (raw !== undefined) { init.body = raw; init.headers = { 'content-type': 'application/json' }; }
  const r = await fetch(url, init);
  return { status: r.status, body: await r.json() as Body };
}

describe('sync.ts', () => {
  it('GET /status merges service status', async () => {
    bq.getSyncStatus.mockResolvedValue({ ga4: 'ok' });
    expect((await call(`${syncBase}/status`)).body).toEqual({ success: true, ga4: 'ok' });
  });
  it('GET /status service throws → 500', async () => {
    bq.getSyncStatus.mockRejectedValue(new Error('bq'));
    const r = await call(`${syncBase}/status`);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'bq' });
  });
  it('POST /trigger ignores any body (even malformed-looking strings) and calls syncAll once', async () => {
    bq.syncAll.mockResolvedValue({ rows: 3 });
    const r = await call(`${syncBase}/trigger`, 'POST', '{"x":"\'; DROP TABLE y;--"}');
    expect(r.body).toEqual({ success: true, rows: 3 });
    expect(bq.syncAll).toHaveBeenCalledTimes(1);
  });
  it('POST /trigger throws → 500', async () => {
    bq.syncAll.mockRejectedValue(new Error('x'));
    expect((await call(`${syncBase}/trigger`, 'POST')).status).toBe(500);
  });
  it('POST /profiles rebuilds then links', async () => {
    bq.rebuildUserProfiles.mockResolvedValue(12);
    bq.linkToCustomers.mockResolvedValue({ linked: 4 });
    expect((await call(`${syncBase}/profiles`, 'POST')).body).toEqual({ success: true, profiles_rebuilt: 12, linked: 4 });
  });
  it('POST /profiles link failure → 500', async () => {
    bq.rebuildUserProfiles.mockResolvedValue(1);
    bq.linkToCustomers.mockRejectedValue(new Error('link'));
    expect((await call(`${syncBase}/profiles`, 'POST')).status).toBe(500);
  });
  it('POST /phpadmin-run-now reports the summary status', async () => {
    phpRun.mockResolvedValue({ status: 'success', inserted: 3 });
    expect((await call(`${syncBase}/phpadmin-run-now`, 'POST')).body).toEqual({ success: true, status: 'success', inserted: 3 });
    expect(phpRun).toHaveBeenCalledWith({ triggeredBy: 'manual-api' });
    phpRun.mockResolvedValue({ status: 'error' });
    expect((await call(`${syncBase}/phpadmin-run-now`, 'POST')).body.success).toBe(false);
  });
  it('POST /phpadmin-run-now throws → 500', async () => {
    phpRun.mockRejectedValue(new Error('mysql'));
    expect((await call(`${syncBase}/phpadmin-run-now`, 'POST')).status).toBe(500);
  });
});

describe('mysqlSync.ts triggers (spawn mocked)', () => {
  it('POST /trigger runs incremental_sync.py with no args and returns output', async () => {
    script = c => { c.stdout.emit('data', Buffer.from('synced 5')); c.emit('close', 0); };
    const r = await call(`${mysqlBase}/trigger`, 'POST');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.stdout).toBe('synced 5');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0];
    expect(args[0]).toMatch(/incremental_sync\.py$/);
    expect(args.slice(1)).toEqual([]);
  });
  it('POST /trigger?full=true passes --full', async () => {
    await call(`${mysqlBase}/trigger?full=true`, 'POST');
    expect(spawnMock.mock.calls[0][1].slice(1)).toEqual(['--full']);
  });
  it('POST /trigger?full=yes is not treated as full', async () => {
    await call(`${mysqlBase}/trigger?full=yes`, 'POST');
    expect(spawnMock.mock.calls[0][1].slice(1)).toEqual([]);
  });
  it('non-zero exit → 500 with stderr', async () => {
    script = c => { c.stderr.emit('data', Buffer.from('boom')); c.emit('close', 2); };
    const r = await call(`${mysqlBase}/trigger`, 'POST');
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ success: false, exitCode: 2, stderr: 'boom' });
  });
  it('spawn error event → 500 exitCode -1', async () => {
    script = c => { c.emit('error', new Error('ENOENT python3')); };
    const r = await call(`${mysqlBase}/trigger`, 'POST');
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ exitCode: -1, stderr: 'ENOENT python3' });
  });
  it('stdout is truncated to the last 4000 chars', async () => {
    script = c => { c.stdout.emit('data', Buffer.from('a'.repeat(5000) + 'END')); c.emit('close', 0); };
    const r = await call(`${mysqlBase}/trigger`, 'POST');
    expect(r.body.stdout?.length).toBe(4000);
    expect(r.body.stdout?.endsWith('END')).toBe(true);
    expect(lastChild?.kill).not.toHaveBeenCalled();
  });
  for (const t of ['contacts', 'chats', 'unsubscribed', 'tickets']) {
    it(`POST /trigger/${t} passes the table`, async () => {
      await call(`${mysqlBase}/trigger/${t}?full=true`, 'POST');
      expect(spawnMock.mock.calls[0][1].slice(1)).toEqual([t, '--full']);
    });
  }
  for (const bad of ['travel', 'contacts;rm -rf ~', '..%2F..%2Fetc', 'CONTACTS', '--full']) {
    it(`POST /trigger/${bad} → 400 and never spawns`, async () => {
      const r = await call(`${mysqlBase}/trigger/${bad}`, 'POST');
      expect(r.status).toBe(400);
      expect(spawnMock).not.toHaveBeenCalled();
    });
  }
});
