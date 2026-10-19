// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authFetch, getStrategies, getUnifiedContacts, getUnifiedStats, getAffinityCustomers,
  createStrategy, deleteJourney, getJourneyAnalyticsTable, getEmailUtmLog, getSendLog,
  getChatLeadsDepartmentUsers, getSegments, downloadReportCSV,
} from '@/lib/api';

const BASE = 'http://localhost:3001';
const AUTH_KEY = 'rayna-auth';

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;
let fetchMock: FetchMock;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const callUrl = (i = 0): string => String(fetchMock.mock.calls[i][0]);
const callInit = (i = 0): RequestInit => fetchMock.mock.calls[i][1] ?? {};
const callHeaders = (i = 0): Record<string, string> => (callInit(i).headers ?? {}) as Record<string, string>;

const storeAuth = (token: string, refreshToken?: string): void => {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, refreshToken, user: { id: 1, email: 'a@b.c', name: 'A', role: 'admin' } }));
};

beforeEach(() => {
  fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request building', () => {
  it('prefixes BASE, sends JSON content type and returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [1, 2] }));
    await expect(getStrategies()).resolves.toEqual({ data: [1, 2] });
    expect(callUrl()).toBe(`${BASE}/api/v2/strategies`);
    expect(callHeaders()['Content-Type']).toBe('application/json');
    expect(callHeaders().Authorization).toBeUndefined();
  });

  it('adds the bearer token from localStorage', async () => {
    storeAuth('tok-1');
    fetchMock.mockResolvedValueOnce(json({}));
    await getStrategies();
    expect(callHeaders().Authorization).toBe('Bearer tok-1');
  });

  it('ignores malformed auth storage instead of throwing', async () => {
    localStorage.setItem(AUTH_KEY, '{not json');
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(getStrategies()).resolves.toEqual({});
    expect(callHeaders().Authorization).toBeUndefined();
  });

  it('serialises query params (String() on every value, URL-encoded)', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await getUnifiedContacts({ page: 2, search: 'a b&c', flag: true });
    expect(callUrl()).toBe(`${BASE}/api/v3/unified-contacts?page=2&search=a+b%26c&flag=true`);
  });

  it('omits the "?" when there are no params', async () => {
    fetchMock.mockResolvedValue(json({}));
    await getUnifiedStats();
    await getEmailUtmLog();
    expect(callUrl(0)).toBe(`${BASE}/api/v3/unified-contacts/stats`);
    expect(callUrl(1)).toBe(`${BASE}/api/v3/test-sends/utm-log`);
  });

  it('affinity/send-log drop empty and null params', async () => {
    fetchMock.mockResolvedValue(json({}));
    await getAffinityCustomers({ view: 'service', period: '', search: null, limit: 0 });
    await getSendLog({ a: '', b: undefined });
    expect(callUrl(0)).toBe(`${BASE}/api/v3/booking-affinity/customers?view=service&limit=0`);
    expect(callUrl(1)).toBe(`${BASE}/api/v3/test-sends/send-log`);
  });

  it('encodes user-controlled path/query pieces where the helper encodes them', async () => {
    fetchMock.mockResolvedValue(json({}));
    await getJourneyAnalyticsTable('a&b=c');
    await getChatLeadsDepartmentUsers('Sales/UAE & co', '2026-01-01', '2026-01-31', { onlyNew: true });
    expect(callUrl(0)).toBe(`${BASE}/api/v3/journeys/analytics/table?status=a%26b%3Dc`);
    expect(callUrl(1)).toContain('receiver=Sales%2FUAE%20%26%20co');
    expect(callUrl(1)).toContain('&only_new=1&limit=50&offset=0');
  });

  it('sends method and JSON body for writes', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }, 201));
    await createStrategy({ name: 'x', n: null });
    expect(callInit().method).toBe('POST');
    expect(callInit().body).toBe('{"name":"x","n":null}');
  });

  it('returns null for 204 No Content without parsing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteJourney(5)).resolves.toBeNull();
  });

  it('getSegments flattens funnel stages and tolerates missing arrays', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [
      { stage_name: 'S1', stage_color: '#f00', segments: [{ id: 1 }] },
      { stage_name: 'S2' },
    ] }));
    await expect(getSegments()).resolves.toEqual([{ id: 1, stage_name: 'S1', stage_color: '#f00' }]);
    fetchMock.mockResolvedValueOnce(json({}));
    await expect(getSegments()).resolves.toEqual([]);
  });
});

describe('error handling', () => {
  it('uses the JSON error message on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Invalid date range' }, 400));
    await expect(getStrategies()).rejects.toThrow('Invalid date range');
  });

  it('falls back to HTTP status when the error body is empty/null/non-JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: '' }, 404));
    await expect(getStrategies()).rejects.toThrow('HTTP 404');
    fetchMock.mockResolvedValueOnce(json(null, 500));
    await expect(getStrategies()).rejects.toThrow('HTTP 500');
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(getStrategies()).rejects.toThrow('HTTP 502');
  });

  it('stringifies non-string error values', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 42 }, 422));
    await expect(getStrategies()).rejects.toThrow('42');
  });

  it('resolves null for a 200 with a non-JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 200 }));
    await expect(getStrategies()).resolves.toBeNull();
  });

  it('propagates network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getStrategies()).rejects.toThrow('Failed to fetch');
  });

  it('download helpers reject on non-OK', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
    await expect(downloadReportCSV('t', '2026-01-01', '2026-01-02')).rejects.toThrow('Download failed: HTTP 500');
  });
});

describe('401 refresh flow', () => {
  it('without a refresh token: clears auth and throws session expired', async () => {
    storeAuth('old');
    fetchMock.mockResolvedValueOnce(json({ error: 'expired' }, 401));
    await expect(getStrategies()).rejects.toThrow('Session expired');
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once and retries with the new token', async () => {
    storeAuth('old', 'r1');
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ data: { token: 'new' } }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await expect(getStrategies()).resolves.toEqual({ ok: 1 });
    expect(callUrl(1)).toBe(`${BASE}/api/auth/refresh`);
    expect(callInit(1).body).toBe('{"refreshToken":"r1"}');
    expect(callHeaders(2).Authorization).toBe('Bearer new');
    const stored = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') as { token?: string; refreshToken?: string };
    expect(stored).toMatchObject({ token: 'new', refreshToken: 'r1' });
  });

  it('dedupes concurrent refreshes', async () => {
    storeAuth('old', 'r1');
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) return json({ data: { token: 'new' } });
      const h = (init?.headers ?? {}) as Record<string, string>;
      return h.Authorization === 'Bearer new' ? json({ ok: 1 }) : json({}, 401);
    });
    await Promise.all([getStrategies(), getStrategies(), getStrategies()]);
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/api/auth/refresh'))).toHaveLength(1);
  });

  it('failed refresh (5xx, missing token, network) ends in session expired', async () => {
    for (const refreshRes of [json({}, 500), json({ data: {} }), Promise.reject(new Error('net'))]) {
      fetchMock.mockReset();
      storeAuth('old', 'r1');
      fetchMock.mockResolvedValueOnce(json({}, 401)).mockImplementationOnce(() => Promise.resolve(refreshRes));
      await expect(getStrategies()).rejects.toThrow('Session expired');
      expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    }
  });

  it('does not loop when the retried request is 401 again', async () => {
    storeAuth('old', 'r1');
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ data: { token: 'new' } }))
      .mockResolvedValueOnce(json({}, 401));
    await expect(getStrategies()).rejects.toThrow('Session expired');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never refreshes for /api/auth/ endpoints', async () => {
    storeAuth('old', 'r1');
    fetchMock.mockResolvedValueOnce(json({}, 401));
    const res = await authFetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('authFetch keeps caller headers and passes non-401 through untouched', async () => {
    storeAuth('t');
    fetchMock.mockResolvedValueOnce(json({}, 403));
    const res = await authFetch('/x', { headers: { 'X-A': '1' } });
    expect(res.status).toBe(403);
    expect(callHeaders()).toEqual({ 'X-A': '1', Authorization: 'Bearer t' });
  });
});
