import { test, expect } from 'vitest';
import { buildCarouselCards } from '../src/utils/waCarousel.js';
import type { ChatheadTemplateBody, ChatheadCarouselCardInput, ChatheadTemplateButton } from '../src/types/routesChathead.js';

const card = (over: ChatheadCarouselCardInput = {}): ChatheadCarouselCardInput => ({
  header_format: 'image',
  media_file: 'https://example.com/a.jpg',
  body: 'Desert Safari with {{extra}}',
  body_examples: { extra: 'BBQ dinner' },
  buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a' }],
  ...over,
});
const body = (over: ChatheadTemplateBody = {}): ChatheadTemplateBody => ({ category: 'marketing', formate: 'carousel', body: 'Top picks', cards: [card(), card()], ...over });

test('valid carousel builds one card per input card', () => {
  const r = buildCarouselCards(body());
  expect(r.error).toBeUndefined();
  expect(r.cards).toHaveLength(2);
  expect(r.cards![0]).toStrictEqual({
    header_format: 'image', media_file: 'https://example.com/a.jpg',
    body: 'Desert Safari with {{extra}}', body_examples: { extra: 'BBQ dinner' },
    buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a', example: undefined }],
  });
});

test('card body and buttons are optional', () => {
  const r = buildCarouselCards(body({ cards: [card({ body: '', buttons: [] }), card({ body: undefined, buttons: undefined })] }));
  expect(r.cards![1]).toStrictEqual({ header_format: 'image', media_file: 'https://example.com/a.jpg', body_examples: { extra: 'BBQ dinner' } });
});

test('only marketing category', () => {
  expect(buildCarouselCards(body({ category: 'utility' })).error).toMatch(/marketing/);
});

test('top-level footer, media and buttons are rejected', () => {
  expect(buildCarouselCards(body({ footer_text: 'x' })).error).toMatch(/'footer_text' is not allowed/);
  expect(buildCarouselCards(body({ media_file: 'https://x' })).error).toMatch(/'media_file' is not allowed/);
  expect(buildCarouselCards(body({ buttons: [{ type: 'quick_reply', value: 'Hi' }] })).error).toMatch(/Top-level buttons/);
});

test('needs 2 to 10 cards', () => {
  expect(buildCarouselCards(body({ cards: [card()] })).error).toMatch(/between 2 and 10/);
  expect(buildCarouselCards(body({ cards: Array.from({ length: 11 }, () => card()) })).error).toMatch(/between 2 and 10/);
  expect(buildCarouselCards(body({ cards: Array.from({ length: 10 }, () => card()) })).cards).toHaveLength(10);
});

test('header format must be image/video and the same on every card', () => {
  expect(buildCarouselCards(body({ cards: [card({ header_format: 'document' }), card()] })).error).toMatch(/Card 1 header_format/);
  expect(buildCarouselCards(body({ cards: [card(), card({ header_format: 'video' })] })).error).toMatch(/same header_format/);
});

test('every card needs a media file', () => {
  expect(buildCarouselCards(body({ cards: [card(), card({ media_file: '  ' })] })).error).toMatch(/Card 2 media_file is missing/);
});

test('card body is capped at 160 characters', () => {
  expect(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(161) }), card()] })).error).toMatch(/160 characters/);
  expect(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(160) }), card()] })).cards).toBeTruthy();
});

test('at most 2 buttons, no OTP, and the same kinds in the same order', () => {
  const qr: ChatheadTemplateButton = { type: 'quick_reply', value: 'More' };
  const url: ChatheadTemplateButton = { type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://x' };
  expect(buildCarouselCards(body({ cards: [card({ buttons: [qr, qr, qr] }), card()] })).error).toMatch(/at most 2 buttons/);
  expect(buildCarouselCards(body({ cards: [card({ buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }), card()] })).error).toMatch(/only supports quick reply, URL and phone/);
  expect(buildCarouselCards(body({ cards: [card({ buttons: [url, qr] }), card({ buttons: [qr, url] })] })).error).toMatch(/same button types in the same order/);
  // static and dynamic URL buttons count as the same kind
  const dyn: ChatheadTemplateButton = { type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari' };
  expect(buildCarouselCards(body({ cards: [card({ buttons: [url] }), card({ buttons: [dyn] })] })).cards).toBeTruthy();
});

test('dynamic URL buttons need {{1}} and an example', () => {
  const dyn = (over: ChatheadTemplateButton): ChatheadTemplateButton => ({ type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari', ...over });
  expect(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ value: 'https://x' })] }), card()] })).error).toMatch(/\{\{1\}\} placeholder/);
  expect(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ example: ' ' })] }), card()] })).error).toMatch(/example value/);
});

test('tidy runs on card body and button text', () => {
  const r = buildCarouselCards(body(), s => s.toUpperCase());
  expect(r.cards![0].body).toBe('DESERT SAFARI WITH {{EXTRA}}');
  expect(r.cards![0].buttons![0].text).toBe('BOOK');
});
