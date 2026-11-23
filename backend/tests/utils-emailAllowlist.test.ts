import { describe, it, expect, afterEach, vi } from 'vitest';
import { allowedEmailSet, allowlistActive, isEmailAllowed } from '../src/utils/emailAllowlist.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('emailAllowlist', () => {
  it('disabled when unset', () => {
    vi.stubEnv('WELCOME_EMAILS', undefined);
    expect(allowedEmailSet()).toBeNull();
    expect(allowlistActive()).toBe(false);
    expect(isEmailAllowed('anyone@x.com')).toBe(true);
    expect(isEmailAllowed('')).toBe(true);
    expect(isEmailAllowed(null)).toBe(true);
  });

  it.each(['', '   ', ',', ' , ,, '])('disabled when only blanks/commas: %j', (v) => {
    vi.stubEnv('WELCOME_EMAILS', v);
    expect(allowedEmailSet()).toBeNull();
    expect(allowlistActive()).toBe(false);
    expect(isEmailAllowed('a@b.com')).toBe(true);
  });

  it('parses, trims, lowercases and dedupes', () => {
    vi.stubEnv('WELCOME_EMAILS', ' A@X.com, b@y.com ,a@x.com,,');
    expect([...(allowedEmailSet() ?? [])]).toEqual(['a@x.com', 'b@y.com']);
    expect(allowlistActive()).toBe(true);
  });

  it('enforces case-insensitive, trimmed matching', () => {
    vi.stubEnv('WELCOME_EMAILS', 'a@x.com');
    expect(isEmailAllowed('A@X.COM')).toBe(true);
    expect(isEmailAllowed('  a@x.com\n')).toBe(true);
    expect(isEmailAllowed('a@x.co')).toBe(false);
    expect(isEmailAllowed('xa@x.com')).toBe(false);
  });

  it.each([null, undefined, '', 0, false])('blank %j rejected when enforced', (e) => {
    vi.stubEnv('WELCOME_EMAILS', 'a@x.com');
    expect(isEmailAllowed(e)).toBe(false);
  });

  it('handles unicode addresses', () => {
    vi.stubEnv('WELCOME_EMAILS', 'JÖRG@exämple.de');
    expect(isEmailAllowed('jörg@exämple.de')).toBe(true);
  });

  it('re-reads env on every call', () => {
    vi.stubEnv('WELCOME_EMAILS', 'a@x.com');
    expect(isEmailAllowed('b@x.com')).toBe(false);
    vi.stubEnv('WELCOME_EMAILS', 'b@x.com');
    expect(isEmailAllowed('b@x.com')).toBe(true);
  });
});
