import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import defaultExport, {
  renderTemplate, buildLiquidVars, buildWaVars, isItemBased, missingItemFields, RCS_DATA_KEYS, WA_DATA_KEYS,
} from '../src/utils/placeholderResolver.js';
import type { PlaceholderContext } from '../src/types/utilsPlaceholder.js';

const SITE = 'https://www.raynatours.com';
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { warn.mockRestore(); });

const productCtx: PlaceholderContext = {
  contact: { id: 11, name: 'Mr. Vaibhav  Gupta', email: 'v@x.com', mobile: '+971500', city: 'Dubai', country: 'UAE', is_indian: 'true', geography: 'LOCAL', segments: ['a', 'b'] },
  event: { page_url: 'https://www.raynatours.com/dubai/desert-safari', event_name: 'view_item', event_id: 'e1', journey_id: 3, node_id: 'n1' },
  payload: {
    itemName: 'Desert <Safari> & "BBQ"', itemId: 'p1', imageUrl: 'https://img.test/Saudi Arabia Visa/a b.jpg', currency: 'AED', city: 'Dubai',
    ecommerceData: { value: null, items: [{ item_name: 'ignored', price: 199, adult_count: 2, children_count: 1 }, { item_name: 'second' }] },
  },
};

describe('renderTemplate', () => {
  it.each([null, undefined, ''])('falsy html %j -> empty string', (h) => {
    expect(renderTemplate(h, productCtx)).toBe('');
  });

  it('resolves canonical keys, whitespace inside braces, and HTML-escapes values', () => {
    expect(renderTemplate('{{ITEM_NAME}}|{{  CURRENCY  }}|{{ITEM_PRICE}}', productCtx))
      .toBe('Desert &lt;Safari&gt; &amp; &quot;BBQ&quot;|AED|199');
  });

  it('strips (repeated) honorifics; USER_FIRST_NAME is the full cleaned name', () => {
    const ctx: PlaceholderContext = { contact: { name: 'Mrs.  Dr Priya Sharma' } };
    expect(renderTemplate('{{USER_NAME}}/{{USER_FIRST_NAME}}/{{customer_name}}', ctx)).toBe('Priya Sharma/Priya Sharma/Priya Sharma');
  });

  it('does not strip honorific-like prefixes inside words', () => {
    expect(renderTemplate('{{USER_NAME}}', { contact: { name: 'Mrinal Sen' } })).toBe('Mrinal Sen');
  });

  it('USER_FIRST_NAME defaults to "there"; inline default wins over per-key default', () => {
    expect(renderTemplate('Hi {{USER_FIRST_NAME}}', {})).toBe('Hi there');
    expect(renderTemplate("Hi {{ USER_FIRST_NAME | default: 'friend' }}", {})).toBe('Hi friend');
    expect(renderTemplate('Hi {{first_name|default:"pal"}}', {})).toBe('Hi pal');
  });

  it('inline default is escaped and ignored when value present', () => {
    expect(renderTemplate("{{ITEM_NAME | default: '<b>'}}", {})).toBe('&lt;b&gt;');
    expect(renderTemplate("{{CURRENCY | default: 'USD'}}", productCtx)).toBe('AED');
  });

  it('aliases and case-insensitive canonical keys', () => {
    expect(renderTemplate('{{item_name}}|{{Product_Name}}|{{rec2_price}}|{{destination_city}}|{{cta_url}}', productCtx))
      .toBe('Desert &lt;Safari&gt; &amp; &quot;BBQ&quot;|Desert &lt;Safari&gt; &amp; &quot;BBQ&quot;|199|Dubai|https://www.raynatours.com/dubai/desert-safari');
  });

  it('unknown keys render blank (never literal) and warn once', () => {
    expect(renderTemplate('a{{NOPE}}b{{NOPE}}c{{ITEM_CATEGORY}}', {})).toBe('abc');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('NOPE');
    expect(String(warn.mock.calls[0][0])).not.toContain('ITEM_CATEGORY');
  });

  it('leaves malformed placeholders untouched', () => {
    expect(renderTemplate('{{ITEM-NAME}} {ITEM_NAME} {{}}', productCtx)).toBe('{{ITEM-NAME}} {ITEM_NAME} {{}}');
  });

  it('contact fields: IS_*, segments, RID, image space-encoding', () => {
    expect(renderTemplate('{{IS_INDIAN_USER}}|{{IS_LOCAL_USER}}|{{CUSTOMER_SEGMENT}}|{{RID}}|{{ITEM_IMAGE_URL}}', productCtx))
      .toBe('Yes|Yes|a, b|11|https://img.test/Saudi%20Arabia%20Visa/a%20b.jpg');
    expect(renderTemplate('{{IS_INDIAN_USER}}', { contact: { is_indian: false } })).toBe('No');
    expect(renderTemplate('{{IS_INDIAN_USER}}', { contact: { is_indian: 'false' } })).toBe('No');
    expect(renderTemplate('{{IS_INDIAN_USER}}', { contact: { is_indian: null } })).toBe('');
    expect(renderTemplate('{{CUSTOMER_SEGMENT}}', { contact: { segments: 'vip' } })).toBe('vip');
  });

  it('falls back to event.raw_payload and ecommerce item fields', () => {
    const ctx: PlaceholderContext = { event: { raw_payload: { ecommerce: { currency: 'INR', items: [{ item_name: 'Ferrari World', price: 0, city: 'Abu Dhabi' }] } } } };
    expect(renderTemplate('{{ITEM_NAME}}|{{CURRENCY}}|{{ITEM_PRICE}}|{{DESTINATION_CITY}}', ctx)).toBe('Ferrari World|INR|0|Abu Dhabi');
  });

  it('order-based URLs encode the order id; defaults without one', () => {
    expect(renderTemplate('{{VIEW_BOOKING_URL}} {{RETRY_PAYMENT_URL}}', { payload: { transactionId: 'A/1 b' } }))
      .toBe(`${SITE}/booking/A%2F1%20b ${SITE}/payment/retry?order=A%2F1%20b`);
    expect(renderTemplate('{{VIEW_BOOKING_URL}} {{RETRY_PAYMENT_URL}} {{RESUME_CHECKOUT_URL}} {{O_URL}}', {}))
      .toBe(`${SITE}/my-bookings ${SITE}/checkout ${SITE}/checkout ${SITE}`);
  });

  it('EVENT_TIMESTAMP: invalid created_at renders empty; payload timestamp fallback', () => {
    expect(renderTemplate('{{EVENT_TIMESTAMP}}', { event: { created_at: 'not-a-date' } })).toBe('');
    expect(renderTemplate('{{EVENT_TIMESTAMP}}', { payload: { timestamp: 't0' } })).toBe('t0');
  });

  it('affinity: empty values render blank', () => {
    const ctx: PlaceholderContext = { affinity: { product_affinity_1: 'Safari', product_affinity_2: '' } };
    expect(renderTemplate('[{{PRODUCT_AFFINITY_1}}][{{PRODUCT_AFFINITY_2}}]', ctx)).toBe('[Safari][]');
  });

  // Suspected BUG (placeholderResolver.ts:29): esc() does not escape single quotes, so a value
  // dropped into a single-quoted HTML attribute (href='{{ITEM_URL}}') can break out of it.
  it("BUG: single quotes should be escaped", () => {
    expect(renderTemplate('{{ITEM_NAME}}', { payload: { itemName: "O'Neil" } })).not.toContain("'");
  });
});

describe('buildLiquidVars', () => {
  it('exposes every ecommerce item plus lowercase non-empty affinity keys', () => {
    const v: Record<string, unknown> = buildLiquidVars({ ...productCtx, affinity: { product_affinity_1: 'X', service_affinity_1: '' } });
    expect(v.items).toHaveLength(2);
    expect(v.product_affinity_1).toBe('X');
    expect('service_affinity_1' in v).toBe(false);
    expect(v.PRODUCT_AFFINITY_1).toBe('X');
    expect(v.SERVICE_AFFINITY_1).toBeUndefined();
    expect(v.ITEM_NAME).toBe('Desert <Safari> & "BBQ"');
  });
  it('items is [] when there is no array', () => {
    expect(buildLiquidVars().items).toEqual([]);
    expect(buildLiquidVars({ payload: { ecommerceData: { items: undefined } } }).items).toEqual([]);
  });
});

describe('buildWaVars', () => {
  it('"*" emits lowercase canon keys + aliases, drops empties and raw_payload', () => {
    const v = buildWaVars(productCtx);
    expect(v.item_name).toBe('Desert <Safari> & "BBQ"');
    expect(v.product_name).toBe(v.item_name);
    expect(v.rec1_name).toBe(v.item_name);
    expect(v.raw_payload).toBeUndefined();
    expect(v.item_category).toBeUndefined();
    expect(v.name).toBe('Vaibhav  Gupta');
  });

  it('button URL is relative (scheme+host stripped) and always present', () => {
    const v = buildWaVars(productCtx);
    expect(v['0_url']).toBe('dubai/desert-safari');
    expect(v.o_url).toBe('dubai/desert-safari');
    const empty = buildWaVars({});
    expect(empty['0_url']).toBe('');
    expect(empty.o_url).toBe('');
  });

  it('img always present: contact img > item image > default', () => {
    expect(buildWaVars({ contact: { img: 'https://c/i.png' } }).img).toBe('https://c/i.png');
    expect(buildWaVars(productCtx).img).toBe('https://img.test/Saudi%20Arabia%20Visa/a%20b.jpg');
    expect(buildWaVars({}).img).toBe(`${SITE}/rayna-og.jpg`);
  });

  it('item_price always present (empty string when none); name defaults blank-safe', () => {
    const v = buildWaVars({});
    expect(v.item_price).toBe('');
    expect(v.name).toBeUndefined();
    expect(v.user_first_name).toBeUndefined();
  });

  it('explicit key list emits only those keys (plus the compulsory ones), trimmed', () => {
    const v = buildWaVars({ payload: { itemName: '  Burj  ', city: 'Dubai' }, contact: { name: 'Ana' } }, RCS_DATA_KEYS);
    expect(v).toEqual({ item_name: 'Burj', destination_city: 'Dubai', user_first_name: 'Ana', name: 'Ana', img: `${SITE}/rayna-og.jpg`, '0_url': '', o_url: '', item_price: '' });
  });

  it('"all" behaves like "*"', () => {
    expect(buildWaVars(productCtx, 'all')).toEqual(buildWaVars(productCtx, WA_DATA_KEYS));
  });

  it('numeric zero price is kept as "0" in item_price', () => {
    expect(buildWaVars({ payload: { eventValue: 0 } }).item_price).toBe('0');
  });
});

describe('isItemBased', () => {
  it.each<[string, unknown, boolean]>([
    ['view_item', null, true], ['purchase', undefined, true], ['page_view', 'p1', true], ['page_view', 0, true],
    ['page_view', '_noitem', false], ['page_view', '  ', false], ['page_view', null, false], ['', '', false],
    ['VIEW_ITEM', null, false],
  ])('(%j, %j) -> %s', (e, id, out) => {
    expect(isItemBased(e, id)).toBe(out);
  });
});

describe('missingItemFields', () => {
  const full = { ITEM_NAME: 'x', ITEM_PRICE: 0, ITEM_IMAGE_URL: 'i', CURRENCY: 'AED', DESTINATION_CITY: 'Dubai', ITEM_URL: 'u' };
  it('complete -> []', () => {
    expect(missingItemFields(full)).toEqual([]);
    expect(missingItemFields({ item_name: 'x', item_price: '1', item_image: 'i', currency: 'a', destination_city: 'c', cta_url: 'u' })).toEqual([]);
  });
  it('empty / no arg -> all six', () => {
    const all = ['ITEM_NAME', 'ITEM_PRICE', 'ITEM_IMAGE_URL', 'CURRENCY', 'DESTINATION_CITY', 'URL'];
    expect(missingItemFields()).toEqual(all);
    expect(missingItemFields({})).toEqual(all);
  });
  it.each(['NA', 'n/a', ' NULL ', 'undefined', 'None', '-', '', '   '])('placeholder junk %j counts as empty', (j) => {
    expect(missingItemFields({ ...full, CURRENCY: j })).toEqual(['CURRENCY']);
  });
  it('falls through junk to the next alias', () => {
    expect(missingItemFields({ ...full, ITEM_NAME: 'NA', item_name: 'real' })).toEqual([]);
  });
  it('visa category (any case) exempts destination city', () => {
    expect(missingItemFields({ ...full, DESTINATION_CITY: '', ITEM_CATEGORY: 'Tourist VISA' })).toEqual([]);
    expect(missingItemFields({ ...full, DESTINATION_CITY: '', service_type: 'visas' })).toEqual([]);
    expect(missingItemFields({ ...full, DESTINATION_CITY: '', ITEM_CATEGORY: 'tour' })).toEqual(['DESTINATION_CITY']);
  });
  it('WhatsApp img key is NOT accepted as an image', () => {
    expect(missingItemFields({ ...full, ITEM_IMAGE_URL: '', img: 'x' })).toEqual(['ITEM_IMAGE_URL']);
  });
});

describe('default export', () => {
  it('re-exports the API', () => {
    expect(defaultExport.renderTemplate).toBe(renderTemplate);
    expect(defaultExport.WA_DATA_KEYS).toBe('*');
    expect(defaultExport.RCS_DATA_KEYS).toBe(RCS_DATA_KEYS);
  });
});
