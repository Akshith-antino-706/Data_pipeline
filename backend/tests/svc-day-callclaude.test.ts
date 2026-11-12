import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { default: { query }, query };
});

import { _internals as d1 } from '../src/services/Day1WelcomeRankingService.js';
import { _internals as d2 } from '../src/services/Day2CruiseRankingService.js';
import { _internals as d4 } from '../src/services/Day4HolidaysRankingService.js';
import { _internals as d5 } from '../src/services/Day5ActivitiesRankingService.js';
import { _internals as d6 } from '../src/services/Day6DestinationRankingService.js';
import { _internals as d7 } from '../src/services/Day7AbandonedCartRankingService.js';

type CallClaude = typeof d1.callClaude;
const impls: Array<[string, CallClaude, number]> = [
  ['Day1', d1.callClaude, 7], ['Day2', d2.callClaude, 7], ['Day4', d4.callClaude, 6],
  ['Day5', d5.callClaude, 6], ['Day6', d6.callClaude, 6], ['Day7', d7.callClaude, 6],
];

const fetchMock = vi.fn<typeof fetch>();
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const textMsg = (...texts: string[]) => ({ model: 'm', usage: { input_tokens: 1, output_tokens: 2 }, content: texts.map(t => ({ type: 'text', text: t })) });
const sentBody = (): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.ANTHROPIC_API_KEY = 'test-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe.each(impls)('%s callClaude', (_name, callClaude, maxUses) => {
  it('throws NO_API_KEY without calling fetch', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow('NO_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts with headers, web_search tool and parses the last text block', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      model: 'claude-x', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'server_tool_use' }, { type: 'server_tool_use' }, { type: 'text', text: 'ignore' }, { type: 'text', text: 'Here: {"a":1,"b":"ü"} done' }],
    }));
    const r = await callClaude({ system: 'sys', user: 'usr', model: 'mm' });
    expect(r.parsed).toEqual({ a: 1, b: 'ü' });
    expect(r.webSearchCalls).toBe(2);
    expect(r.model).toBe('claude-x');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    const body = sentBody();
    expect(body.model).toBe('mm');
    expect(body.system).toBe('sys');
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }]);
  });

  it('omits tools when useWebSearch=false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textMsg('{}')));
    await callClaude({ system: 's', user: 'u', useWebSearch: false });
    expect(sentBody().tools).toBeUndefined();
  });

  it('HTTP error includes status and truncated body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('x'.repeat(1000), 529));
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow(/^Claude HTTP 529: x{300}$/);
  });

  it.each([[{ content: [] }], [{}], [textMsg('')]])('no text content -> throws (%j)', async (payload) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow('Claude returned no text content');
  });

  it('no JSON object -> throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textMsg('just prose')));
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow('No JSON object');
  });

  it('invalid JSON -> throws parse error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textMsg('{not json}')));
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow('JSON parse failed');
  });

  it('propagates network errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(callClaude({ system: 's', user: 'u' })).rejects.toThrow('fetch failed');
  });

  // BUG: the greedy /\{[\s\S]*\}/ spans from the first "{" to the LAST "}", so any brace in
  // trailing prose breaks parsing of an otherwise valid JSON reply (e.g. Day1WelcomeRankingService.ts:217,
  // same pattern in Day2/4/5/6/7).
  it('parses JSON followed by prose containing braces', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textMsg('{"a":1}\nNote: see {sources}')));
    await expect(callClaude({ system: 's', user: 'u' })).resolves.toMatchObject({ parsed: { a: 1 } });
  });
});
