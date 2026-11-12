import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));

import { ChatHeadV1Service } from '../src/services/ChatHeadV1Service.js';

type Row = Record<string, string>;
const savedRows = (): Row[] => JSON.parse(String(mockQuery.mock.calls.at(-1)?.[1]?.[2] ?? '[]')) as Row[];
const htmlResponse = (body: string) => Promise.resolve(new Response(body, { status: 200 }));

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 9, filename: 'f.data' }] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ChatHeadV1Service header image', () => {
  it('fills img from the default media only on rows that have none', async () => {
    const r = await ChatHeadV1Service.buildAndSaveDataFile(
      [{ phone: ' +971 50-567-1946', vars: { img: 'https://own/x.png' } }, { phone: '971505671947' }],
      { filename: 'a.data', defaultMedia: 'https://tpl/header.jpg' },
    );
    const rows = savedRows();
    expect(rows[0]).toMatchObject({ d: '971505671946', img: 'https://own/x.png' });
    expect(rows[1]).toMatchObject({ d: '971505671947', img: 'https://tpl/header.jpg' });
    expect(r).toMatchObject({ id: 9, filename: 'f.data', mediaFilled: 1 });
  });

  it('still accepts a bare filename and falls back to the site image', async () => {
    await ChatHeadV1Service.buildAndSaveDataFile([{ phone: '971505671946' }], 'b.data');
    expect(mockQuery.mock.calls.at(-1)?.[1]?.[0]).toBe('b.data');
    expect(savedRows()[0]?.img).toMatch(/\/rayna-og\.jpg$/);
  });

  it('reads the template image from the rendered preview, and null on a JSON error', async () => {
    const fetchSpy = vi.fn()
      .mockImplementationOnce(() => htmlResponse('<div><img class="h" src="https://cdn/t1.jpg"></div>'))
      .mockImplementationOnce(() => htmlResponse('{"status":"error"}'));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await ChatHeadV1Service.fetchTemplateMedia(901)).toBe('https://cdn/t1.jpg');
    expect(await ChatHeadV1Service.fetchTemplateMedia(901)).toBe('https://cdn/t1.jpg'); // cached
    expect(await ChatHeadV1Service.fetchTemplateMedia(902)).toBeNull();
    expect(await ChatHeadV1Service.fetchTemplateMedia('')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    expect(await ChatHeadV1Service.fetchTemplateMedia(903)).toBeNull();
  });
});
