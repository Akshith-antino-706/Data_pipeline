import { describe, it, expect } from 'vitest';
import { injectClickTracking, injectOpenPixel } from '../src/utils/emailTracking.js';

const BASE = 'https://api.example.test';
const opts = { logId: 42, baseUrl: BASE, campaign: 'day1', content: 'welcome' };

function trackedDest(html: string): URL {
  const m = /href="([^"]+)"/.exec(html);
  if (!m) throw new Error('no href');
  const track = new URL(m[1]);
  expect(track.origin + track.pathname).toBe(`${BASE}/api/track/email-send/click/42`);
  return new URL(track.searchParams.get('url') ?? '');
}

describe('injectClickTracking', () => {
  it('wraps an http(s) link with tracking + default UTM params', () => {
    const d = trackedDest(injectClickTracking('<a href="https://site.test/p?a=1">x</a>', opts));
    expect(d.origin + d.pathname).toBe('https://site.test/p');
    expect(Object.fromEntries(d.searchParams)).toEqual({ a: '1', utm_source: 'AI_marketer', utm_medium: 'email', utm_campaign: 'day1', utm_content: 'welcome' });
  });

  it('overrides existing UTM params, keeps fragments', () => {
    const d = trackedDest(injectClickTracking('<a href="http://s.test/?utm_source=old#frag">x</a>', { ...opts, source: 'src', medium: 'med' }));
    expect(d.searchParams.get('utm_source')).toBe('src');
    expect(d.searchParams.get('utm_medium')).toBe('med');
    expect(d.hash).toBe('#frag');
  });

  it('adds rid / journeyId / nodeId and sanitises nodeId in utm_content', () => {
    const d = trackedDest(injectClickTracking('<a href="https://s.test/">x</a>', { ...opts, unifiedId: 9, journeyId: 5, nodeId: 'action 2/ü' }));
    expect(d.searchParams.get('rid')).toBe('9');
    expect(d.searchParams.get('journeyId')).toBe('5');
    expect(d.searchParams.get('nodeId')).toBe('action 2/ü');
    expect(d.searchParams.get('utm_content')).toBe('welcome_j5_action_2__');
  });

  it('omits falsy unifiedId / journeyId (including 0)', () => {
    const d = trackedDest(injectClickTracking('<a href="https://s.test/">x</a>', { ...opts, unifiedId: 0, journeyId: 0, nodeId: '' }));
    expect(d.searchParams.has('rid')).toBe(false);
    expect(d.searchParams.has('journeyId')).toBe(false);
    expect(d.searchParams.has('nodeId')).toBe(false);
    expect(d.searchParams.get('utm_content')).toBe('welcome');
  });

  it('leaves own tracking, utm-redirect, mailto, tel, relative and single-quoted links alone', () => {
    const html = [
      `<a href="${BASE}/api/track/x">a</a>`,
      '<a href="https://s.test/api/v3/utm/abc">b</a>',
      '<a href="mailto:a@b.c">c</a>', '<a href="tel:+1">d</a>', '<a href="/rel">e</a>',
      "<a href='https://s.test/'>f</a>", '<a HREF="https://s.test/">g</a>',
    ].join('');
    expect(injectClickTracking(html, opts)).toBe(html);
  });

  it('rewrites every link in the document', () => {
    const out = injectClickTracking('<a href="https://a.test/">1</a><a href="https://b.test/">2</a>', opts);
    expect(out.match(/\/api\/track\/email-send\/click\/42/g)).toHaveLength(2);
  });

  it('leaves malformed URLs as-is', () => {
    const html = '<a href="http://exa mple .com:99999/">x</a>';
    expect(injectClickTracking(html, opts)).toBe(html);
  });

  it('empty html -> empty string', () => {
    expect(injectClickTracking('', opts)).toBe('');
  });
});

describe('injectOpenPixel', () => {
  const pixel = `<img src="${BASE}/api/track/email-send/open/7" width="1" height="1" style="display:none" alt="" />`;
  it('inserts before </body>', () => {
    expect(injectOpenPixel('<html><body>hi</body></html>', 7, BASE)).toBe(`<html><body>hi${pixel}</body></html>`);
  });
  it('appends when there is no </body>', () => {
    expect(injectOpenPixel('hi', '7', BASE)).toBe(`hi${pixel}`);
    expect(injectOpenPixel('', 7, BASE)).toBe(pixel);
  });
  it('only the first </body> is used; uppercase </BODY> is not matched', () => {
    expect(injectOpenPixel('</body></body>', 7, BASE)).toBe(`${pixel}</body></body>`);
    expect(injectOpenPixel('x</BODY>', 7, BASE)).toBe(`x</BODY>${pixel}`);
  });
});
