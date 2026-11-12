import { describe, it, expect } from 'vitest';
import { CONTACT_TYPES, normalizeContactType, parseBusinessType } from '../src/utils/contactTypes.js';

describe('contactTypes', () => {
  it('exposes the three stored values', () => {
    expect(CONTACT_TYPES).toEqual(['B2C', 'B2B', 'Affiliate']);
  });

  it.each([
    ['b2c', 'B2C'], ['B2B', 'B2B'], ['  b2b  ', 'B2B'], ['AFFILIATE', 'Affiliate'], ['affiliate', 'Affiliate'], ['\tB2c\n', 'B2C'],
  ])('normalizes %j -> %s', (input, out) => {
    expect(normalizeContactType(input)).toBe(out);
  });

  it.each([null, undefined, '', '   ', 'All', 'b2 b', 'B2C,B2B', 'b2c ✓', 0, false, {}, []])('returns null for %j', (v) => {
    expect(normalizeContactType(v)).toBeNull();
  });

  // BUG (contactTypes.ts:9): BY_LOWER is a plain object literal, so inherited keys like
  // 'constructor' / 'tostring' resolve to Object.prototype functions instead of null.
  it('BUG: does not match prototype keys', () => {
    expect(normalizeContactType('constructor')).toBeNull();
    expect(normalizeContactType('__proto__')).toBeNull();
  });

  it('parseBusinessType returns undefined instead of null', () => {
    expect(parseBusinessType('b2b')).toBe('B2B');
    expect(parseBusinessType('all')).toBeUndefined();
    expect(parseBusinessType(undefined)).toBeUndefined();
    expect(parseBusinessType(null)).toBeUndefined();
  });
});
