import { describe, it, expect, afterEach } from 'vitest';
import { allowedEmailSet, isEmailAllowed } from '../src/utils/emailAllowlist.js';
import { normalizeContactType, parseBusinessType } from '../src/utils/contactTypes.js';
import { format } from '../src/utils/currency.js';

describe('emailAllowlist (audit V5)', () => {
  const saved = process.env.WELCOME_EMAILS;
  afterEach(() => { process.env.WELCOME_EMAILS = saved; });

  it('unset → gate disabled, every address allowed', () => {
    delete process.env.WELCOME_EMAILS;
    expect(allowedEmailSet()).toBeNull();
    expect(isEmailAllowed('anyone@example.com')).toBe(true);
  });

  it('empty → also disabled (the risky default the audit flagged)', () => {
    process.env.WELCOME_EMAILS = '  ,  ';
    expect(allowedEmailSet()).toBeNull();
    expect(isEmailAllowed('anyone@example.com')).toBe(true);
  });

  it('set → only listed addresses, case-insensitive', () => {
    process.env.WELCOME_EMAILS = 'QA@Example.com, ops@example.com';
    expect(isEmailAllowed('qa@example.com')).toBe(true);
    expect(isEmailAllowed(' OPS@example.com ')).toBe(true);
    expect(isEmailAllowed('other@example.com')).toBe(false);
    expect(isEmailAllowed('')).toBe(false);
  });
});

describe('contactTypes', () => {
  it('normalises any spelling to the stored value', () => {
    expect(normalizeContactType(' b2b ')).toBe('B2B');
    expect(normalizeContactType('AFFILIATE')).toBe('Affiliate');
    expect(normalizeContactType('nope')).toBeNull();
  });
  it('treats All / unknown as no filter', () => {
    expect(parseBusinessType('All')).toBeUndefined();
    expect(parseBusinessType('b2c')).toBe('B2C');
  });
});

describe('currency.format', () => {
  it('formats whole units with symbols', () => {
    expect(format(1234.6, 'AED')).toMatch(/1,235/);
    expect(format('x')).toBe('');
  });
});
