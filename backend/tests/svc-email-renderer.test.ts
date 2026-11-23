import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  default: { query: vi.fn() },
}));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ default: {} }));
vi.mock('../src/services/ProductAffinityService.js', () => ({ default: { getTemplateProducts: vi.fn() } }));
vi.mock('../src/services/PopularityService.js', () => ({ default: { getSnapshot: vi.fn() } }));

import { query } from '../src/config/database.js';
import ProductAffinityService from '../src/services/ProductAffinityService.js';
import PopularityService from '../src/services/PopularityService.js';
import EmailRenderer from '../src/services/EmailRenderer.js';
import type { PopularitySnapshotRow } from '../src/types/emailRender.js';
import type { PopularitySnapshotDbRow } from '../src/types/productsAffinityPopularity.js';

type Products = Awaited<ReturnType<typeof ProductAffinityService.getTemplateProducts>>;
type Primary = NonNullable<Products['primaryProduct']>;
type Rec = Products['recommendations'][number];
const primary = (p: Partial<Primary> = {}): Primary => ({ name: '', price: null, image: null, url: null, reason: '', ...p });
const rec = (p: Partial<Rec> = {}): Rec => ({ name: '', price: null, image: null, url: null, city: null, category: null, ...p });
const products = (pp: Primary | null, recs: Rec[] = []): Products => ({ primaryProduct: pp, recommendations: recs, type: 'personalized' });

const res = (rows: QueryResultRow[]): QueryResult<QueryResultRow> => ({ rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] });
const mq = vi.mocked(query);
const mProducts = vi.mocked(ProductAffinityService.getTemplateProducts);
const mSnap = vi.mocked(PopularityService.getSnapshot);

const snapRow = (p: Partial<PopularitySnapshotRow> = {}): PopularitySnapshotRow => ({
  theme: null, position: 1, product_id: '1', name: 'Safari', category: 'Tours', location: 'Dubai',
  duration: '6h', price: 'AED 100', image_url: 'https://img/x.jpg', product_url: 'https://www.raynatours.com/safari', ...p,
});
const dbRow = (p: Partial<PopularitySnapshotDbRow> = {}): PopularitySnapshotDbRow => ({
  theme: null, position: 1, product_id: '1', name: 'Safari', category: 'Tours', location: 'Dubai',
  duration: '6h', price: 'AED 100', image_url: 'https://img/x.jpg', product_url: 'https://www.raynatours.com/safari', ...p,
});
const snap = (rows: PopularitySnapshotDbRow[], key = '_default'): Map<string, PopularitySnapshotDbRow[]> => new Map([[key, rows]]);

beforeEach(() => {
  mq.mockReset();
  mProducts.mockReset();
  mSnap.mockReset();
  delete process.env.PUBLIC_SITE_URL;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('EmailRenderer.render', () => {
  const tpl = (p: Record<string, unknown> = {}) => ({ id: 1, subject: 'Hi {{first_name}}', body: 'plain', html_body: '<p>{{first_name}} {{email}} {{city_name}}</p><a href="https://www.raynatours.com/x">x</a>', html_type: 'static', html_category: null, ...p });

  it('throws when the template does not exist, with parameterised SQL', async () => {
    mq.mockResolvedValueOnce(res([]));
    const evil = "1 OR 1=1; --";
    await expect(EmailRenderer.render(evil, null)).rejects.toThrow(`Template ${evil} not found`);
    expect(mq.mock.calls[0][0]).toMatch(/WHERE ct\.id = \$1/);
    expect(mq.mock.calls[0][1]).toEqual([evil]);
  });

  it('uses defaults and skips the user lookup when unifiedId is null/0', async () => {
    mq.mockResolvedValueOnce(res([tpl()]));
    const out = await EmailRenderer.render(1, 0);
    expect(mq).toHaveBeenCalledTimes(1);
    expect(out.subject).toBe('Hi there');
    expect(out.html).toContain('<p>there  Dubai</p>');
    expect(out.plainText).toBe('plain');
  });

  it('personalises from the contact and ignores blank extraVars', async () => {
    mq.mockResolvedValueOnce(res([tpl()])).mockResolvedValueOnce(res([{ name: 'Ali', email: 'ali@x.com', city: 'Abu Dhabi' }]));
    const out = await EmailRenderer.render(1, 9, { first_name: '  ', email: null, city_name: 'Paris' });
    expect(mq.mock.calls[1]).toEqual(['SELECT * FROM unified_contacts WHERE id = $1', [9]]);
    expect(out.subject).toBe('Hi Ali');
    expect(out.html).toContain('<p>Ali ali@x.com Paris</p>');
  });

  it('falls back to body, then subject for plainText', async () => {
    mq.mockResolvedValueOnce(res([tpl({ html_body: null, body: null, subject: 'S' })]));
    const out = await EmailRenderer.render(1, null);
    expect(out).toEqual({ subject: 'S', html: '', plainText: 'S' });
  });

  it('looks up affinity only when the template uses it', async () => {
    mq.mockResolvedValueOnce(res([tpl({ html_body: '{{product_affinity_1}}' })]))
      .mockResolvedValueOnce(res([{ name: 'A' }]))
      .mockResolvedValueOnce(res([{ product_1_name: 'Burj' }]));
    const out = await EmailRenderer.render(1, 5);
    expect(mq.mock.calls[2][0]).toMatch(/user_affinity_top3/);
    expect(out.html).toBe('Burj');
  });

  it('injects product cards for dynamic templates only', async () => {
    mProducts.mockResolvedValue(products(primary({ name: 'Yacht', reason: 'You viewed' })));
    mq.mockResolvedValueOnce(res([tpl({ html_type: 'dynamic', html_body: '<!-- PRODUCT_CARDS -->' })])).mockResolvedValueOnce(res([{}]));
    const out = await EmailRenderer.render(1, 5);
    expect(mProducts).toHaveBeenCalledWith(5);
    expect(out.html).toContain('Yacht');
    expect(out.html).toContain('You viewed');
  });

  // Suspected bug (EmailRenderer.ts:83/91): values are passed as String.replace replacement
  // strings, so "$&", "$'" etc. in a contact's name are expanded instead of inserted literally.
  it('inserts a name containing "$&" literally', async () => {
    mq.mockResolvedValueOnce(res([tpl()])).mockResolvedValueOnce(res([{ name: 'Rich $& Co' }]));
    const out = await EmailRenderer.render(1, 9);
    expect(out.subject).toBe('Hi Rich $& Co');
  });
});

describe('EmailRenderer.injectProductCards', () => {
  it('returns html unchanged when no products', async () => {
    mProducts.mockResolvedValueOnce(products(null));
    expect(await EmailRenderer.injectProductCards('<x/>', 1, 'u')).toBe('<x/>');
  });
  it('replaces a products-section div and caps recommendations at 3', async () => {
    mProducts.mockResolvedValueOnce(products(null, ['R1', 'R2', 'R3', 'R4'].map(name => rec({ name }))));
    const out = await EmailRenderer.injectProductCards('<div class="products-section">OLDCONTENT</div>', 1, 'u');
    expect(out).not.toContain("OLDCONTENT");
    expect(out).toContain('R3');
    expect(out).not.toContain('R4');
    expect(out.match(/Recommended for you/g)).toHaveLength(3);
  });
  it('leaves html without a marker untouched', async () => {
    mProducts.mockResolvedValueOnce(products(primary({ name: 'P' })));
    expect(await EmailRenderer.injectProductCards('<p>static</p>', 1, 'u')).toBe('<p>static</p>');
  });
  it('swallows lookup errors', async () => {
    mProducts.mockRejectedValueOnce(new Error('db'));
    expect(await EmailRenderer.injectProductCards('<!-- PRODUCT_CARDS -->', 1, 'u')).toBe('<!-- PRODUCT_CARDS -->');
  });
});

describe('EmailRenderer.buildProductCard', () => {
  it('applies defaults for missing fields', () => {
    const html = EmailRenderer.buildProductCard({}, undefined, 'https://utm');
    expect(html).toContain('placeholder.jpg');
    expect(html).toContain('alt="Experience"');
    expect(html).toContain('href="https://utm"');
    expect(html).not.toContain('font-size:16px;font-weight:700');
  });
  it('renders price when present', () => {
    expect(EmailRenderer.buildProductCard({ price: 'AED 5' }, 'L', 'u')).toContain('AED 5');
  });
  // Suspected bug (EmailRenderer.ts:149-167): product fields are interpolated unescaped into HTML/attrs.
  it('escapes HTML in product names', () => {
    expect(EmailRenderer.buildProductCard({ name: '"><script>x</script>' }, 'L', 'u')).not.toContain('<script>');
  });
});

describe('EmailRenderer.injectUTMLinks', () => {
  const utm = 'https://www.raynatours.com/?utm_source=email&utm_medium=journey&rid=7&other=1';
  it.each([null, undefined, '', 'not a url', 'https://www.raynatours.com/no-utm'])('returns html unchanged for %j', (u) => {
    expect(EmailRenderer.injectUTMLinks('<a href="https://raynatours.com/a">', u)).toBe('<a href="https://raynatours.com/a">');
  });
  it('appends only utm_* and rid to raynatours links, preserving paths', () => {
    const html = '<a href="https://www.raynatours.com/a/b">1</a><a href="http://raynatours.com/c?x=1">2</a><a href="https://evil.com/raynatours.com">3</a>';
    const out = EmailRenderer.injectUTMLinks(html, utm);
    expect(out).toContain('href="https://www.raynatours.com/a/b?utm_source=email&utm_medium=journey&rid=7"');
    expect(out).toContain('href="http://raynatours.com/c?x=1&utm_source=email&utm_medium=journey&rid=7"');
    expect(out).toContain('href="https://evil.com/raynatours.com"');
    expect(out).not.toContain('other=1');
  });
  it('leaves links that already have utm_source', () => {
    const h = '<a href="https://www.raynatours.com/?utm_source=x">';
    expect(EmailRenderer.injectUTMLinks(h, utm)).toBe(h);
  });
  it('is case-sensitive on the domain (RAYNATOURS.COM untouched)', () => {
    const h = '<a href="https://www.RAYNATOURS.COM/a">';
    expect(EmailRenderer.injectUTMLinks(h, utm)).toBe(h);
  });
});

describe('EmailRenderer._buildUtmLink', () => {
  it('builds full params and slugifies', () => {
    const u = new URL(EmailRenderer._buildUtmLink({ journeyId: 3, nodeId: 'Day 1 — Émail!', htmlTemplateName: '  Cruise Promo  ', unifiedId: 42 }));
    expect(u.searchParams.get('utm_source')).toBe('email');
    expect(u.searchParams.get('utm_medium')).toBe('journey');
    expect(u.searchParams.get('utm_campaign')).toBe('general_broadcast');
    expect(u.searchParams.get('utm_content')).toBe('j3_day_1_mail');
    expect(u.searchParams.get('utm_term')).toBe('cruise_promo');
    expect(u.searchParams.get('rid')).toBe('42');
  });
  it('omits optional params when missing/zero', () => {
    const link = EmailRenderer._buildUtmLink({ journeyId: 0, nodeId: 'n', htmlTemplateName: null, unifiedId: 0 });
    expect(link).toBe('https://www.raynatours.com/?utm_source=email&utm_medium=journey&utm_campaign=general_broadcast');
  });
  it('uses & when base already has a query', () => {
    expect(EmailRenderer._buildUtmLink({ journeyId: null, nodeId: null, htmlTemplateName: null, unifiedId: null, base: 'https://x.com/?a=1' }))
      .toMatch(/^https:\/\/x\.com\/\?a=1&utm_source=email/);
  });
  it('neutralises injection in the template name', () => {
    const link = EmailRenderer._buildUtmLink({ journeyId: 1, nodeId: 'n', htmlTemplateName: "x'&utm_source=evil<script>", unifiedId: 1 });
    expect(new URL(link).searchParams.getAll('utm_source')).toEqual(['email']);
  });
});

describe('EmailRenderer slot helpers', () => {
  it('_parseSlotAttrs parses quoted attrs only', () => {
    expect(EmailRenderer._parseSlotAttrs('product_type="activity" theme="thrill" count=4 cols = "3"')).toEqual({ product_type: 'activity', theme: 'thrill', cols: '3' });
    expect(EmailRenderer._parseSlotAttrs('')).toEqual({});
  });
  it('_extractUtmQuery', () => {
    expect(EmailRenderer._extractUtmQuery(null)).toBe('');
    expect(EmailRenderer._extractUtmQuery('nope')).toBe('');
    expect(EmailRenderer._extractUtmQuery('https://a.com/?utm_x=1&b=2&rid=3')).toBe('utm_x=1&rid=3');
  });
  it('_escape / _escapeAttr', () => {
    expect(EmailRenderer._escape(null)).toBe('');
    expect(EmailRenderer._escape('<a&b>"')).toBe('&lt;a&amp;b&gt;"');
    expect(EmailRenderer._escapeAttr(undefined)).toBe('');
    expect(EmailRenderer._escapeAttr('"a&b<')).toBe('&quot;a&amp;b<');
    expect(EmailRenderer._escape(0)).toBe('0');
  });
  it('_buildProductGrid lays out rows by cols and escapes values', () => {
    const rows = [snapRow({ name: '<b>One</b>' }), snapRow({ product_url: null }), snapRow({ product_url: 'https://x.com/?utm_source=a' })];
    const out = EmailRenderer._buildProductGrid(rows, 2, 'https://w.com/?utm_source=email');
    expect(out.match(/<tr><td width="50%"/g)).toHaveLength(2);
    expect(out).toContain('&lt;b&gt;One&lt;/b&gt;');
    expect(out).toContain('href="https://www.raynatours.com/safari?utm_source=email"');
    expect(out).toContain('href="#"');
    expect(out).toContain('href="https://x.com/?utm_source=a"');
  });
});

describe('EmailRenderer.expandProductSlots / expandHeroImageSlots', () => {
  const base = { journeyId: 1, nodeId: 'n1', runId: 'r1', utmLink: 'https://www.raynatours.com/?utm_source=email' };

  it('returns input when no slots', async () => {
    expect(await EmailRenderer.expandProductSlots({ ...base, html: '<p/>' })).toEqual({ html: '<p/>', slotsFilled: 0 });
    expect(await EmailRenderer.expandHeroImageSlots({ ...base, html: '<p/>' })).toEqual({ html: '<p/>', slotsFilled: 0 });
    expect(mSnap).not.toHaveBeenCalled();
  });

  it('fills a grid slot with count limit, one snapshot lookup per type', async () => {
    mSnap.mockResolvedValue(snap([dbRow({ name: 'A' }), dbRow({ name: 'B' }), dbRow({ name: 'C' })]));
    const html = 'x<!-- SLOT:product_grid product_type="activity" count="2" -->y<!-- SLOT:product_grid product_type="activity" theme="none" -->';
    const out = await EmailRenderer.expandProductSlots({ ...base, html });
    expect(mSnap).toHaveBeenCalledTimes(1);
    expect(mSnap).toHaveBeenCalledWith({ journeyId: 1, nodeId: 'n1', runId: 'r1', productType: 'activity' });
    expect(out.slotsFilled).toBe(2);
    expect(out.html).not.toContain('SLOT:');
  });

  it('drops a grid slot with an empty snapshot and uses fallbackProductType', async () => {
    mSnap.mockResolvedValue(new Map());
    const out = await EmailRenderer.expandProductSlots({ ...base, fallbackProductType: 'cruise', html: 'a<!-- SLOT:product_grid count="0" -->b' });
    expect(mSnap.mock.calls[0][0].productType).toBe('cruise');
    expect(out).toEqual({ html: 'ab', slotsFilled: 0 });
  });

  it('builds a hero image from the top row and escapes attrs', async () => {
    mSnap.mockResolvedValue(snap([dbRow({ name: 'Top "1"' })]));
    const out = await EmailRenderer.expandHeroImageSlots({ ...base, html: '<!-- SLOT:hero_image product_type="activity" height="300" -->' });
    expect(out.slotsFilled).toBe(1);
    expect(out.html).toContain('alt="Top &quot;1&quot;"');
    expect(out.html).toContain('height: 300px');
    expect(out.html).toContain('href="https://www.raynatours.com/safari?utm_source=email"');
  });

  it('drops the hero marker when the top row has no image', async () => {
    mSnap.mockResolvedValue(snap([dbRow({ image_url: '' })]));
    const out = await EmailRenderer.expandHeroImageSlots({ ...base, html: '[<!-- SLOT:hero_image product_type="x" -->]' });
    expect(out).toEqual({ html: '[]', slotsFilled: 0 });
  });
});

describe('EmailRenderer.renderForJourneyNode', () => {
  const htpl = (p: Record<string, unknown> = {}) => ({ id: 1, name: 'Win Back', html_body: '<p>{{first_name}}</p>', preview_text: null, engine: 'regex', subject_line: 'Hey {{first_name}}', uses_popular_products: false, product_type: null, product_limit: null, ...p });

  it('throws when not found', async () => {
    mq.mockResolvedValueOnce(res([]));
    await expect(EmailRenderer.renderForJourneyNode({ htmlTemplateId: 99, unifiedId: null, journeyId: 1, nodeId: 'n', runId: 'r' })).rejects.toThrow('html_template 99 not found');
    expect(mq.mock.calls[0][1]).toEqual([99]);
  });

  it('renders regex templates and uses subject_override', async () => {
    mq.mockResolvedValueOnce(res([htpl()])).mockResolvedValueOnce(res([{ name: 'Sara' }]));
    const out = await EmailRenderer.renderForJourneyNode({ htmlTemplateId: 1, unifiedId: 3, journeyId: 1, nodeId: 'n', runId: 'r', extraVars: { subject_override: 'Yo {{first_name}}' } });
    expect(mq.mock.calls[1][1]).toEqual([3]);
    expect(out.subject).toBe('Yo Sara');
    expect(out.plainText).toBe('Yo Sara');
    expect(out.html).toBe('<p>Sara</p>');
    expect(out.slotsFilled).toBe(0);
  });

  it('falls back subject → preview_text → name → empty', async () => {
    mq.mockResolvedValueOnce(res([htpl({ subject_line: null, preview_text: null, name: null, html_body: null })]));
    const out = await EmailRenderer.renderForJourneyNode({ htmlTemplateId: 1, unifiedId: null, journeyId: 1, nodeId: 'n', runId: 'r' });
    expect(out.subject).toBe('');
    expect(out.html).toBe('');
  });

  it('renders liquid templates with GTM payload vars and drops empty affinity', async () => {
    const body = "{% case service_type %}{% when 'Cruise' %}C:{{ destination_city }}{% else %}X{% endcase %}|{% if product_affinity_1 %}A{% else %}N{% endif %}|{{ rec1_price }}";
    mq.mockResolvedValueOnce(res([htpl({ engine: 'liquid', html_body: body })]))
      .mockResolvedValueOnce(res([{ name: 'Z' }]))
      .mockResolvedValueOnce(res([{ raw_payload: { itemCategory: 'Cruise', city: 'Muscat', eventValue: 0 }, page_url: null }]))
      .mockResolvedValueOnce(res([{}]));
    const out = await EmailRenderer.renderForJourneyNode({ htmlTemplateId: 1, unifiedId: 3, journeyId: 1, nodeId: 'n', runId: 'r' });
    expect(mq.mock.calls[2][0]).toMatch(/FROM gtm_events/);
    expect(out.html).toBe('C:Muscat|N|0');
  });

  it('keeps going if the Liquid render throws', async () => {
    mq.mockResolvedValueOnce(res([htpl({ engine: 'liquid', html_body: '{% if %}{{first_name}}' })]));
    const out = await EmailRenderer.renderForJourneyNode({ htmlTemplateId: 1, unifiedId: null, journeyId: 1, nodeId: 'n', runId: 'r' });
    expect(out.html).toBe('{% if %}there');
  });

  it('expands slots only when uses_popular_products and keys are present', async () => {
    mSnap.mockResolvedValue(snap([dbRow()]));
    mq.mockResolvedValueOnce(res([htpl({ uses_popular_products: true, html_body: '<!-- SLOT:hero_image product_type="a" --><!-- SLOT:product_grid product_type="a" -->' })]));
    const out = await EmailRenderer.renderForJourneyNode({ htmlTemplateId: 1, unifiedId: null, journeyId: 1, nodeId: 'n', runId: 'r' });
    expect(out.slotsFilled).toBe(2);
    expect(out.html).toContain('utm_campaign=general_broadcast');
  });
});

describe('EmailRenderer.renderPreview', () => {
  it('throws when not found', async () => {
    mq.mockResolvedValueOnce(res([]));
    await expect(EmailRenderer.renderPreview(1)).rejects.toThrow('Template not found');
  });
  it('renders sample vars, liquid, and lets extraVars override', async () => {
    mq.mockResolvedValueOnce(res([{ subject: null, html_subject_line: 'Hi {{first_name}}', html_body: '{{ product_affinity_1 }} {{coupon_code}}', body: null, html_name: 'T', html_engine: 'liquid', channel: 'email', segment_label: 'S' }]));
    const out = await EmailRenderer.renderPreview(1, { first_name: 'Ünïcode' });
    expect(out).toEqual({ subject: 'Hi Ünïcode', html: 'Desert Safari PREVIEW10', htmlTemplateName: 'T', channel: 'email', segment: 'S' });
  });
  it('null extraVars values become empty strings', async () => {
    mq.mockResolvedValueOnce(res([{ subject: '[{{offer_tag}}]', html_body: null, body: 'b', html_name: null, html_engine: null, channel: null, segment_label: null }]));
    const out = await EmailRenderer.renderPreview(1, { offer_tag: null });
    expect(out.subject).toBe('[]');
    expect(out.html).toBe('b');
    expect(out.htmlTemplateName).toBeNull();
  });
});
