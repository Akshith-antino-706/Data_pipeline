import { describe, it, expect } from 'vitest';
import defaultExport, { currencyForCountry, normalizeCountry } from '../src/utils/countryCurrency.js';

describe('normalizeCountry', () => {
  it.each([
    ['  United   Arab\tEmirates ', 'united arab emirates'],
    ['U.A.E.', 'uae'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [0, ''],
    [123, '123'],
  ])('%j -> %j', (inp, out) => {
    expect(normalizeCountry(inp)).toBe(out);
  });
});

describe('currencyForCountry', () => {
  it.each([
    ['UAE', 'AED'], ['united arab emirates', 'AED'], ['A.E.', 'AED'],
    ['KSA', 'SAR'], ['Saudi Arabia', 'SAR'], ['SAU', 'SAR'],
    ['qatar', 'QAR'], ['KW', 'KWD'], ['Singapore', 'SGD'],
    ['viet nam', 'VND'], ['Burma', 'MMK'], ['Kiribati', 'AUD'], ['new  zealand', 'NZD'],
    ['TUVALU', 'AUD'],
  ])('%s -> %s', (c, cur) => {
    expect(currencyForCountry(c)).toBe(cur);
  });

  it.each([null, undefined, '', '   ', 'Atlantis', 'xx', '...', 0, false])('unknown/blank %j -> null', (c) => {
    expect(currencyForCountry(c)).toBeNull();
  });

  it('is not fooled by prototype property names', () => {
    expect(currencyForCountry('constructor')).toBeNull();
    expect(currencyForCountry('__proto__')).toBeNull();
    expect(currencyForCountry('hasOwnProperty')).toBeNull();
  });

  it('unicode / accented input is not matched (no transliteration)', () => {
    expect(currencyForCountry('Émirates')).toBeNull();
  });

  // Doc comment (countryCurrency.ts:3) promises "punctuation-insensitive" matching, but
  // normalizeCountry (countryCurrency.ts:179) only strips dots — hyphens/commas break the lookup.
  it('BUG: hyphenated name should match ("Saudi-Arabia")', () => {
    expect(currencyForCountry('Saudi-Arabia')).toBe('SAR');
  });

  it('default export exposes both helpers', () => {
    expect(defaultExport.currencyForCountry('in')).toBe(currencyForCountry('in'));
    expect(defaultExport.normalizeCountry).toBe(normalizeCountry);
  });
});
