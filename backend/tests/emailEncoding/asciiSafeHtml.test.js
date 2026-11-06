import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { asciiSafeHtml } from '../../src/utils/asciiSafeHtml.js';
import { ChatheadEmailChannel } from '../../src/services/channels/ChatheadEmailChannel.js';

delete process.env.WELCOME_EMAILS;   // allow-list off: these tests only ever hit the fake relay below

const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
// What a browser / mail app does with character references: turn them back into characters.
const decodeRefs = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

test('currency symbols become character references (₹ € £), $ and letter codes untouched', () => {
  const out = asciiSafeHtml('<p>from ₹25,997 · €120 · £99 · $35 · AED 1,226 · SAR 276</p>');
  assert.equal(out, '<p>from &#8377;25,997 &#183; &#8364;120 &#183; &#163;99 &#183; $35 &#183; AED 1,226 &#183; SAR 276</p>');
  assert.ok(isAscii(out));
});

test('emoji, dashes, curly quotes and accents survive the round trip exactly', () => {
  const src = '<h1>Bali beaches 🌴 – “Hanoi” charm’s café, Zürich 🚢</h1>';
  const out = asciiSafeHtml(src);
  assert.ok(isAscii(out));
  assert.ok(out.includes('&#127796;'), 'emoji is one reference, not two broken halves');
  assert.equal(decodeRefs(out), src);
});

test('attributes are encoded too and decode back to the same value', () => {
  const src = '<img alt="Tour – ₹7,000" title="Café"><a href="https://x.com/?q=café">x</a>';
  const out = asciiSafeHtml(src);
  assert.ok(isAscii(out));
  assert.equal(decodeRefs(out), src);
});

test('<style> gets CSS escapes and <script> gets JS escapes (references do not work there)', () => {
  const out = asciiSafeHtml('<style>.p::before{content:"₹"}</style><p>₹</p><script>var s="₹";</script>');
  assert.equal(out, '<style>.p::before{content:"\\20B9 "}</style><p>&#8377;</p><script>var s="\\u{20B9}";</script>');
  assert.ok(isAscii(out));
});

test('pure ASCII and non-string input are returned unchanged', () => {
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>AED 1,226 &amp; more</body></html>';
  assert.equal(asciiSafeHtml(html), html);
  assert.equal(asciiSafeHtml(''), '');
  assert.equal(asciiSafeHtml(null), null);
  assert.equal(asciiSafeHtml(undefined), undefined);
});

test('existing references and markup are left as they were', () => {
  assert.equal(asciiSafeHtml('<p>&nbsp;&amp;&#8377; ₹</p>'), '<p>&nbsp;&amp;&#8377; &#8377;</p>');
});

// ── The relay transport: what is actually posted for every journey / daily-offer email ──

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeRelay() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ status: 'success', message_id: 'm-1' }), { status: 200 });
  };
  return calls;
}

test('relay transport posts an ASCII-only body that decodes to the original email', async () => {
  const calls = fakeRelay();
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Holidays – from ₹25,997</title></head>'
    + '<body><p>Prices from ₹25,997.</p><p>Genting Dream from ₹77,475 🚢</p><p>Paris from €1,200, London from £990</p></body></html>';
  const res = await ChatheadEmailChannel.send({ to: 'tester@example.com', subject: 'Cruises 🚢 – from ₹25,997', html });
  assert.equal(res.success, true);
  assert.equal(calls.length, 1);
  const posted = calls[0].body;
  assert.ok(isAscii(posted.body), 'no raw non-ASCII character reaches the relay');
  assert.ok(posted.body.includes('Prices from &#8377;25,997.'));
  assert.equal(decodeRefs(posted.body), html, 'the reader sees exactly the original characters');
  assert.equal(posted.subject, 'Cruises 🚢 – from ₹25,997', 'subject is passed through unchanged (the relay encodes headers)');
});

test('relay transport leaves an all-ASCII body byte-for-byte unchanged', async () => {
  const calls = fakeRelay();
  const html = '<html><body><p>AED 1,226</p></body></html>';
  await ChatheadEmailChannel.send({ to: 'tester@example.com', subject: 'Hi', html });
  assert.equal(calls[0].body.body, html);
});
