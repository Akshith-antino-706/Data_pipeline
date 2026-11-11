import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCarouselCards } from '../src/utils/waCarousel.js';

const card = (over = {}) => ({
  header_format: 'image',
  media_file: 'https://example.com/a.jpg',
  body: 'Desert Safari with {{extra}}',
  body_examples: { extra: 'BBQ dinner' },
  buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a' }],
  ...over,
});
const body = (over = {}) => ({ category: 'marketing', formate: 'carousel', body: 'Top picks', cards: [card(), card()], ...over });

test('valid carousel builds one card per input card', () => {
  const r = buildCarouselCards(body());
  assert.equal(r.error, undefined);
  assert.equal(r.cards.length, 2);
  assert.deepEqual(r.cards[0], {
    header_format: 'image', media_file: 'https://example.com/a.jpg',
    body: 'Desert Safari with {{extra}}', body_examples: { extra: 'BBQ dinner' },
    buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a', example: undefined }],
  });
});

test('card body and buttons are optional', () => {
  const r = buildCarouselCards(body({ cards: [card({ body: '', buttons: [] }), card({ body: undefined, buttons: undefined })] }));
  assert.deepEqual(r.cards[1], { header_format: 'image', media_file: 'https://example.com/a.jpg', body_examples: { extra: 'BBQ dinner' } });
});

test('only marketing category', () => {
  assert.match(buildCarouselCards(body({ category: 'utility' })).error, /marketing/);
});

test('top-level footer, media and buttons are rejected', () => {
  assert.match(buildCarouselCards(body({ footer_text: 'x' })).error, /'footer_text' is not allowed/);
  assert.match(buildCarouselCards(body({ media_file: 'https://x' })).error, /'media_file' is not allowed/);
  assert.match(buildCarouselCards(body({ buttons: [{ type: 'quick_reply', value: 'Hi' }] })).error, /Top-level buttons/);
});

test('needs 2 to 10 cards', () => {
  assert.match(buildCarouselCards(body({ cards: [card()] })).error, /between 2 and 10/);
  assert.match(buildCarouselCards(body({ cards: Array.from({ length: 11 }, () => card()) })).error, /between 2 and 10/);
  assert.equal(buildCarouselCards(body({ cards: Array.from({ length: 10 }, () => card()) })).cards.length, 10);
});

test('header format must be image/video and the same on every card', () => {
  assert.match(buildCarouselCards(body({ cards: [card({ header_format: 'document' }), card()] })).error, /Card 1 header_format/);
  assert.match(buildCarouselCards(body({ cards: [card(), card({ header_format: 'video' })] })).error, /same header_format/);
});

test('every card needs a media file', () => {
  assert.match(buildCarouselCards(body({ cards: [card(), card({ media_file: '  ' })] })).error, /Card 2 media_file is missing/);
});

test('card body is capped at 160 characters', () => {
  assert.match(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(161) }), card()] })).error, /160 characters/);
  assert.ok(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(160) }), card()] })).cards);
});

test('at most 2 buttons, no OTP, and the same kinds in the same order', () => {
  const qr = { type: 'quick_reply', value: 'More' };
  const url = { type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://x' };
  assert.match(buildCarouselCards(body({ cards: [card({ buttons: [qr, qr, qr] }), card()] })).error, /at most 2 buttons/);
  assert.match(buildCarouselCards(body({ cards: [card({ buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }), card()] })).error, /only supports quick reply, URL and phone/);
  assert.match(buildCarouselCards(body({ cards: [card({ buttons: [url, qr] }), card({ buttons: [qr, url] })] })).error, /same button types in the same order/);
  // static and dynamic URL buttons count as the same kind
  const dyn = { type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari' };
  assert.ok(buildCarouselCards(body({ cards: [card({ buttons: [url] }), card({ buttons: [dyn] })] })).cards);
});

test('dynamic URL buttons need {{1}} and an example', () => {
  const dyn = (over) => ({ type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari', ...over });
  assert.match(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ value: 'https://x' })] }), card()] })).error, /\{\{1\}\} placeholder/);
  assert.match(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ example: ' ' })] }), card()] })).error, /example value/);
});

test('tidy runs on card body and button text', () => {
  const r = buildCarouselCards(body(), s => s.toUpperCase());
  assert.equal(r.cards[0].body, 'DESERT SAFARI WITH {{EXTRA}}');
  assert.equal(r.cards[0].buttons[0].text, 'BOOK');
});
