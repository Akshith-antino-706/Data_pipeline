import { describe, it, expect, afterEach, vi } from 'vitest';
import { asciiSafeHtml } from '../../src/utils/asciiSafeHtml.js';
import { ChatheadEmailChannel } from '../../src/services/channels/ChatheadEmailChannel.js';

const isAscii = (s: string): boolean => !/[\u0080-\u{10FFFF}]/u.test(s);
// What a browser / mail app does with character references: turn them back into characters.
const decodeRefs = (s: string): string => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

describe('asciiSafeHtml — email bodies every mail app reads the same', () => {
  it('currency symbols become character references (₹ € £), $ and letter codes untouched', () => {
    const out = asciiSafeHtml('<p>from ₹25,997 · €120 · £99 · $35 · AED 1,226 · SAR 276</p>');
    expect(out).toBe('<p>from &#8377;25,997 &#183; &#8364;120 &#183; &#163;99 &#183; $35 &#183; AED 1,226 &#183; SAR 276</p>');
    expect(isAscii(out)).toBe(true);
  });

  it('emoji, dashes, curly quotes and accents survive the round trip exactly', () => {
    const src = '<h1>Bali beaches 🌴 – “Hanoi” charm’s café, Zürich 🚢</h1>';
    const out = asciiSafeHtml(src);
    expect(isAscii(out)).toBe(true);
    expect(out).toContain('&#127796;');            // one reference, not two broken halves
    expect(decodeRefs(out)).toBe(src);
  });

  it('attributes are encoded too and decode back to the same value', () => {
    const src = '<img alt="Tour – ₹7,000" title="Café"><a href="https://x.com/?q=café">x</a>';
    const out = asciiSafeHtml(src);
    expect(isAscii(out)).toBe(true);
    expect(decodeRefs(out)).toBe(src);
  });

  it('<style> gets CSS escapes and <script> gets JS escapes (references do not work there)', () => {
    const out = asciiSafeHtml('<style>.p::before{content:"₹"}</style><p>₹</p><script>var s="₹";</script>');
    expect(out).toBe('<style>.p::before{content:"\\20B9 "}</style><p>&#8377;</p><script>var s="\\u{20B9}";</script>');
    expect(isAscii(out)).toBe(true);
  });

  it('pure ASCII and non-string input are returned unchanged', () => {
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>AED 1,226 &amp; more</body></html>';
    expect(asciiSafeHtml(html)).toBe(html);
    expect(asciiSafeHtml('')).toBe('');
    expect(asciiSafeHtml(null)).toBeNull();
    expect(asciiSafeHtml(undefined)).toBeUndefined();
  });

  it('existing references and markup are left as they were', () => {
    expect(asciiSafeHtml('<p>&nbsp;&amp;&#8377; ₹</p>')).toBe('<p>&nbsp;&amp;&#8377; &#8377;</p>');
  });
});

// ── The relay transport: what is actually posted for every journey / daily-offer email ──

interface RelayPayload { from: string; subject: string; destinations: string[]; body: string; campaign_id: string }

function fakeRelay(): RelayPayload[] {
  const calls: RelayPayload[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as RelayPayload);
    return new Response(JSON.stringify({ status: 'success', message_id: 'm-1' }), { status: 200 });
  });
  return calls;
}

describe('ChatheadEmailChannel — body posted to the AWS relay', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts an ASCII-only body that decodes to the original email; subject untouched', async () => {
    const calls = fakeRelay();
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Holidays – from ₹25,997</title></head>'
      + '<body><p>Prices from ₹25,997.</p><p>Genting Dream from ₹77,475 🚢</p><p>Paris from €1,200, London from £990</p></body></html>';
    const res = await ChatheadEmailChannel.send({ to: 'tester@example.com', subject: 'Cruises 🚢 – from ₹25,997', html });
    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(isAscii(calls[0].body)).toBe(true);
    expect(calls[0].body).toContain('Prices from &#8377;25,997.');
    expect(decodeRefs(calls[0].body)).toBe(html);
    expect(calls[0].subject).toBe('Cruises 🚢 – from ₹25,997');   // the relay encodes headers
  });

  it('leaves an all-ASCII body byte-for-byte unchanged', async () => {
    const calls = fakeRelay();
    const html = '<html><body><p>AED 1,226</p></body></html>';
    await ChatheadEmailChannel.send({ to: 'tester@example.com', subject: 'Hi', html });
    expect(calls[0].body).toBe(html);
  });
});
