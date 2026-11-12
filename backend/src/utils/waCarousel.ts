// WhatsApp carousel templates — validation + payload shape for ChatHead's account/templates/add.
// A carousel is a top-level body above 2–10 cards; each card has its own image/video header,
// optional body (≤160 chars) and up to 2 buttons. Rules mirror ChatHead's own checks so the
// user sees the problem before the request goes out:
//   • category must be marketing
//   • no top-level header_text / footer_text / media_file / buttons — those live on the cards
//   • every card uses the same header_format, and the same button kinds in the same order
//   • card buttons: quick_reply, call_to_action (url|phone) or url_dynamic — no OTP / copy code
import type { ChatheadTemplateBody, ChatheadTemplateButton, ChatheadCarouselCard } from '../types/routesChathead.js';

export const CARD_HEADER_FORMATS: (string | undefined)[] = ['image', 'video'];
export const CARD_BTN_TYPES: (string | undefined)[]      = ['quick_reply', 'call_to_action', 'url_dynamic'];
export const CARD_BODY_MAX       = 160;

const clean = <T,>(s: T): T => (typeof s === 'string' ? s.trim() as T : s);

/** Kind used for the "same buttons on every card" rule — static and dynamic URLs are both URL. */
function buttonKind(btn: ChatheadTemplateButton): string {
  if (btn.type === 'quick_reply') return 'quick_reply';
  return btn.sub_type === 'phone' ? 'phone' : 'url';
}

/** Error message for one card button, or null when it is valid. */
function buttonError(btn: ChatheadTemplateButton, n: number): string | null {
  if (!CARD_BTN_TYPES.includes(btn.type)) return `Card ${n} only supports quick reply, URL and phone buttons!`;
  if (btn.type === 'quick_reply') return btn.value ? null : `Card ${n} quick_reply button needs a value (label)`;
  if (!['url', 'phone'].includes(btn.sub_type as string)) return `Card ${n} button.sub_type must be url or phone (got ${btn.sub_type})`;
  if (!btn.value || !btn.text) return `Card ${n} ${btn.type} button needs value + text`;
  if (btn.type === 'url_dynamic') {
    if (btn.sub_type !== 'url') return `Card ${n} url_dynamic button must be a url`;
    if (!/\{\{\s*1\s*\}\}/.test(btn.value)) return `Card ${n} url_dynamic value must contain the {{1}} placeholder`;
    if (!btn.example) return `Card ${n} url_dynamic button needs a non-empty example value for {{1}}`;
  }
  return null;
}

export type CarouselBuildResult = { error: string; cards?: undefined } | { error?: undefined; cards: ChatheadCarouselCard[] };

/**
 * Validate a carousel request body and build its `cards` array.
 * `tidy` is the text cleaner applied to card body + button text (emoji strip).
 */
export function buildCarouselCards(b: ChatheadTemplateBody, tidy: (s: string) => string = (s) => s): CarouselBuildResult {
  if (b.category !== 'marketing') return { error: 'Carousel templates must use the marketing category!' };
  for (const k of ['header_text', 'footer_text', 'media_file'] as const) {
    if (b[k]) return { error: `'${k}' is not allowed on carousel templates, use cards instead!` };
  }
  if (Array.isArray(b.buttons) && b.buttons.length) return { error: 'Top-level buttons are not allowed on carousel templates, put buttons on the cards!' };

  const cards = Array.isArray(b.cards) ? b.cards : [];
  if (cards.length < 2 || cards.length > 10) return { error: 'Carousel templates need between 2 and 10 cards!' };

  const out: ChatheadCarouselCard[] = [];
  let firstFormat: string | null = null, firstKinds: string | null = null;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i] || {}, n = i + 1;
    if (!CARD_HEADER_FORMATS.includes(c.header_format)) return { error: `Card ${n} header_format must be image or video!` };
    const format = c.header_format as string;
    if (firstFormat == null) firstFormat = format;
    else if (format !== firstFormat) return { error: 'All cards must use the same header_format!' };
    const media = clean(c.media_file);
    if (!media) return { error: `Card ${n} media_file is missing!` };

    const body = c.body ? tidy(String(c.body)) : '';
    if (body.length > CARD_BODY_MAX) return { error: `Card ${n} body must be ${CARD_BODY_MAX} characters or less!` };

    const buttons: ChatheadTemplateButton[] = (Array.isArray(c.buttons) ? c.buttons : []).map(btn => ({
      ...btn, value: clean(btn.value), text: clean(btn.text), example: clean(btn.example),
    }));
    if (buttons.length > 2) return { error: `Card ${n} can have at most 2 buttons!` };
    for (const btn of buttons) {
      const e = buttonError(btn, n);
      if (e) return { error: e };
    }
    const kinds = buttons.map(buttonKind).join(',');
    if (firstKinds == null) firstKinds = kinds;
    else if (kinds !== firstKinds) return { error: 'All cards must have the same button types in the same order!' };

    const card: ChatheadCarouselCard = { header_format: format, media_file: media };
    if (body) card.body = body;
    if (c.body_examples && typeof c.body_examples === 'object') card.body_examples = c.body_examples;
    if (buttons.length) card.buttons = buttons.map(bt => ({ ...bt, ...(bt.text ? { text: tidy(bt.text) } : {}) }));
    out.push(card);
  }
  return { cards: out };
}
