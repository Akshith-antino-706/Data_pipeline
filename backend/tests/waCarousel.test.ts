import { describe, it, expect } from 'vitest';
import { buildCarouselCards, type CarouselResult } from '../src/utils/waCarousel.js';
import type { ChatheadCarouselCard, ChatheadTemplateBody, ChatheadTemplateButton } from '../src/types/routesChathead.js';

const card = (over: Partial<ChatheadCarouselCard> = {}): ChatheadCarouselCard => ({
  header_format: 'image',
  media_file: 'https://example.com/a.jpg',
  body: 'Desert Safari with {{extra}}',
  body_examples: { extra: 'BBQ dinner' },
  buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a' }],
  ...over,
});
const body = (over: Partial<ChatheadTemplateBody> = {}): ChatheadTemplateBody =>
  ({ category: 'marketing', formate: 'carousel', body: 'Top picks', cards: [card(), card()], ...over });

/** The cards of a valid result (fails the test with the error otherwise). */
const cardsOf = (r: CarouselResult) => {
  if (r.error !== undefined) throw new Error(`expected cards, got error: ${r.error}`);
  return r.cards;
};
const errorOf = (r: CarouselResult) => r.error ?? '';

describe('buildCarouselCards — WhatsApp carousel templates', () => {
  it('valid carousel builds one card per input card', () => {
    const cards = cardsOf(buildCarouselCards(body()));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      header_format: 'image', media_file: 'https://example.com/a.jpg',
      body: 'Desert Safari with {{extra}}', body_examples: { extra: 'BBQ dinner' },
      buttons: [{ type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://example.com/a', example: undefined }],
    });
  });

  it('card body and buttons are optional', () => {
    const cards = cardsOf(buildCarouselCards(body({ cards: [card({ body: '', buttons: [] }), card({ body: undefined, buttons: undefined })] })));
    expect(cards[1]).toEqual({ header_format: 'image', media_file: 'https://example.com/a.jpg', body_examples: { extra: 'BBQ dinner' } });
  });

  it('only marketing category', () => {
    expect(errorOf(buildCarouselCards(body({ category: 'utility' })))).toMatch(/marketing/);
  });

  it('top-level footer, media and buttons are rejected', () => {
    expect(errorOf(buildCarouselCards(body({ footer_text: 'x' })))).toMatch(/'footer_text' is not allowed/);
    expect(errorOf(buildCarouselCards(body({ media_file: 'https://x' })))).toMatch(/'media_file' is not allowed/);
    expect(errorOf(buildCarouselCards(body({ buttons: [{ type: 'quick_reply', value: 'Hi' }] })))).toMatch(/Top-level buttons/);
  });

  it('needs 2 to 10 cards', () => {
    expect(errorOf(buildCarouselCards(body({ cards: [card()] })))).toMatch(/between 2 and 10/);
    expect(errorOf(buildCarouselCards(body({ cards: Array.from({ length: 11 }, () => card()) })))).toMatch(/between 2 and 10/);
    expect(cardsOf(buildCarouselCards(body({ cards: Array.from({ length: 10 }, () => card()) })))).toHaveLength(10);
  });

  it('header format must be image/video and the same on every card', () => {
    expect(errorOf(buildCarouselCards(body({ cards: [card({ header_format: 'document' }), card()] })))).toMatch(/Card 1 header_format/);
    expect(errorOf(buildCarouselCards(body({ cards: [card(), card({ header_format: 'video' })] })))).toMatch(/same header_format/);
  });

  it('every card needs a media file', () => {
    expect(errorOf(buildCarouselCards(body({ cards: [card(), card({ media_file: '  ' })] })))).toMatch(/Card 2 media_file is missing/);
  });

  it('card body is capped at 160 characters', () => {
    expect(errorOf(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(161) }), card()] })))).toMatch(/160 characters/);
    expect(cardsOf(buildCarouselCards(body({ cards: [card({ body: 'x'.repeat(160) }), card()] })))).toHaveLength(2);
  });

  it('at most 2 buttons, no OTP, and the same kinds in the same order', () => {
    const qr: ChatheadTemplateButton = { type: 'quick_reply', value: 'More' };
    const url: ChatheadTemplateButton = { type: 'call_to_action', sub_type: 'url', text: 'Book', value: 'https://x' };
    expect(errorOf(buildCarouselCards(body({ cards: [card({ buttons: [qr, qr, qr] }), card()] })))).toMatch(/at most 2 buttons/);
    expect(errorOf(buildCarouselCards(body({ cards: [card({ buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] }), card()] })))).toMatch(/only supports quick reply, URL and phone/);
    expect(errorOf(buildCarouselCards(body({ cards: [card({ buttons: [url, qr] }), card({ buttons: [qr, url] })] })))).toMatch(/same button types in the same order/);
    // static and dynamic URL buttons count as the same kind
    const dyn: ChatheadTemplateButton = { type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari' };
    expect(cardsOf(buildCarouselCards(body({ cards: [card({ buttons: [url] }), card({ buttons: [dyn] })] })))).toHaveLength(2);
  });

  it('dynamic URL buttons need {{1}} and an example', () => {
    const dyn = (over: Partial<ChatheadTemplateButton>): ChatheadTemplateButton =>
      ({ type: 'url_dynamic', sub_type: 'url', text: 'Book', value: 'https://x/{{1}}', example: 'safari', ...over });
    expect(errorOf(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ value: 'https://x' })] }), card()] })))).toMatch(/\{\{1\}\} placeholder/);
    expect(errorOf(buildCarouselCards(body({ cards: [card({ buttons: [dyn({ example: ' ' })] }), card()] })))).toMatch(/example value/);
  });

  it('tidy runs on card body and button text', () => {
    const cards = cardsOf(buildCarouselCards(body(), s => s.toUpperCase()));
    expect(cards[0].body).toBe('DESERT SAFARI WITH {{EXTRA}}');
    expect(cards[0].buttons?.[0].text).toBe('BOOK');
  });
});
