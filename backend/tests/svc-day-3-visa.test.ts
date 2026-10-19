import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { default: { query }, query };
});

import { _internals as render } from '../src/services/Day3VisaRenderer.js';

type Visas = Parameters<typeof render.generateInternationalVisaCards>[0];
type EVisas = Parameters<typeof render.generateEVisaRows>[0];
type Pop = Parameters<typeof render.generatePopularDestinationCards>[0];
type Ratings = Parameters<typeof render.generateRatingsGrid>[0];

const visa = (name: string): Visas[number] => ({ name, image: `https://i/${name}.jpg`, flag: '🇦🇪', types: 'Tourist', link: `https://l/${name}` } as unknown as Visas[number]);

describe('Day3 generateInternationalVisaCards', () => {
  it('2 per row; odd count pads with an empty cell', () => {
    const html = render.generateInternationalVisaCards([visa('a'), visa('b'), visa('c')]);
    expect(html.match(/visa-card-img/g)).toHaveLength(3);
    expect(html.match(/<td width="50%">&nbsp;<\/td>/g)).toHaveLength(1);
    expect(html).toContain('padding: 0 6px 12px 0;');
    expect(html).toContain('padding: 0 0 12px 6px;');
  });
  it('even count has no padding cell', () => {
    expect(render.generateInternationalVisaCards([visa('a'), visa('b')])).not.toContain('&nbsp;');
  });
  it('empty -> wrapper table only', () => {
    expect(render.generateInternationalVisaCards([])).toBe('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse"></table>');
  });
  it('keeps unicode names and does not escape HTML', () => {
    const html = render.generateInternationalVisaCards([visa('Türkiye'), visa('<i>x</i>')]);
    expect(html).toContain('Türkiye');
    expect(html).toContain('<i>x</i>');
  });
});

describe('Day3 generateEVisaRows', () => {
  const ev = (n: string): EVisas[number] => ({ name: n, image: 'i', flag: 'f', country: 'C', details: 'd', status: 'Open', link: 'l' } as unknown as EVisas[number]);
  it('last row has 0 bottom padding, others 8px', () => {
    const html = render.generateEVisaRows([ev('a'), ev('b'), ev('c')]);
    expect(html.match(/padding: 0 0 8px 0/g)).toHaveLength(2);
    expect(html.match(/padding: 0 0 0 0/g)).toHaveLength(1);
  });
  it('single row -> 0 padding', () => {
    expect(render.generateEVisaRows([ev('a')])).toContain('padding: 0 0 0 0');
  });
  it('empty -> wrapper table', () => {
    expect(render.generateEVisaRows([])).not.toContain('<tr>');
  });
});

describe('Day3 generatePopularDestinationCards', () => {
  const p = (n: string): Pop[number] => ({ name: n, image: 'i', link: `l/${n}` } as unknown as Pop[number]);
  it('first has 0 left padding, last 0 right padding', () => {
    const html = render.generatePopularDestinationCards([p('a'), p('b'), p('c')]);
    expect(html).toContain('padding: 0 4px 8px 0;');
    expect(html).toContain('padding: 0 0 8px 4px;');
    expect(html).toContain('padding: 0 4px 8px 4px;');
  });
  it('single item has zero padding both sides', () => {
    expect(render.generatePopularDestinationCards([p('a')])).toContain('padding: 0 0 8px 0;');
  });
  it('empty -> empty row', () => {
    expect(render.generatePopularDestinationCards([])).toMatch(/<tr><\/tr><\/table>$/);
  });
});

describe('Day3 generateRatingsGrid', () => {
  const r = (platform: string): Ratings[number] => ({ platform, stars: '★★★★★', score: '4.8', reviews: '1k' } as unknown as Ratings[number]);
  it.each([
    ['Trustpilot', '#00b67a', 'trustpilot.net'],
    ['Tripadvisor', '#00aa6c', 'tacdn.com'],
    ['Google', '#fbbc04', 'google.com'],
    ['Rayna Tours', '#f5a623', 'raynatourslogo.png'],
  ])('%s gets its colour and logo', (platform, color, logo) => {
    const html = render.generateRatingsGrid([r(platform)]);
    expect(html).toContain(`color: ${color};`);
    expect(html).toContain(logo);
  });
  it('unknown platform / wrong case -> default colours, empty logo', () => {
    const html = render.generateRatingsGrid([r('google')]);
    expect(html).toContain('#f5a623');
    expect(html).toContain('src=""');
  });
  it('odd count does not pad (unlike visa cards)', () => {
    const html = render.generateRatingsGrid([r('Google'), r('Google'), r('Google')]);
    expect(html.match(/review-col/g)).toHaveLength(3);
    expect(html).not.toContain('&nbsp;');
  });
  it('empty -> wrapper only', () => { expect(render.generateRatingsGrid([])).not.toContain('<tr>'); });
});
