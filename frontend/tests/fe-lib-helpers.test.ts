import { describe, it, expect } from 'vitest';
import {
  CONTACT_TYPES, SCOPES, CONTACT_TYPE_LABELS, SCOPE_DESCRIPTIONS, CONTACT_TYPE_COLORS, contactTypeColor,
} from '@/lib/contactTypes';
import { safeEqual, createLeadsAccessCookie, readLeadsAccessCookie, LEADS_ACCESS_COOKIE } from '@/lib/leadsAccess';
import { comboToSlug, slugToCombo } from '@/lib/segmentSlug';

describe('contactTypes', () => {
  it('scopes = All + every type, and every type/scope has a label/description/colour', () => {
    expect(SCOPES).toEqual(['All', ...CONTACT_TYPES]);
    for (const t of CONTACT_TYPES) {
      expect(CONTACT_TYPE_LABELS[t]).toBeTruthy();
      expect(CONTACT_TYPE_COLORS[t].fg).toMatch(/^#/);
    }
    for (const s of SCOPES) expect(SCOPE_DESCRIPTIONS[s]).toBeTruthy();
  });

  it('contactTypeColor falls back to B2C for null/undefined/empty/unknown/prototype keys', () => {
    for (const v of [null, undefined, '', 'b2b', 'Unknown']) {
      expect(contactTypeColor(v)).toEqual(CONTACT_TYPE_COLORS.B2C);
    }
    expect(contactTypeColor('B2B')).toBe(CONTACT_TYPE_COLORS.B2B);
    expect(contactTypeColor('Affiliate')).toBe(CONTACT_TYPE_COLORS.Affiliate);
  });
});

// BUG lib/contactTypes.ts:34 - `type in CONTACT_TYPE_COLORS` walks the prototype chain, so
// inherited keys like 'toString' / 'constructor' return a Function instead of the B2C fallback.
describe('contactTypes prototype keys', () => {
  it.fails('contactTypeColor("toString" | "constructor" | "__proto__") falls back to B2C', () => {
    for (const v of ['toString', 'constructor', '__proto__']) expect(contactTypeColor(v)).toEqual(CONTACT_TYPE_COLORS.B2C);
  });
});

describe('leadsAccess', () => {
  const TOKEN = 'tok';
  it('exposes the cookie name', () => expect(LEADS_ACCESS_COOKIE).toBe('rayna-leads-access'));

  it('safeEqual coerces non-strings and handles empties', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual(undefined, 'undefined')).toBe(true);
    expect(safeEqual(null, '')).toBe(false);
    expect(safeEqual(12, '12')).toBe(true);
  });

  it('cookie format is "<expires>.<64 hex>" and deterministic', async () => {
    const a = await createLeadsAccessCookie(TOKEN, 1_900_000_000_000);
    expect(a).toMatch(/^1900000000000\.[0-9a-f]{64}$/);
    expect(await createLeadsAccessCookie(TOKEN, 1_900_000_000_000)).toBe(a);
  });

  it('rejects malformed / tampered values', async () => {
    const exp = Date.now() + 60_000;
    const good = await createLeadsAccessCookie(TOKEN, exp);
    const [, sig] = good.split('.');
    const bad: (string | null | undefined)[] = [
      null, undefined, '.', 'abc', `${exp}`, `${exp}.`, `.${sig}`, `NaN.${sig}`, `0.${sig}`, `-1.${sig}`,
      `${exp + 1}.${sig}`, `${exp}.${sig.toUpperCase()}`, `${exp}.${sig}x`,
    ];
    for (const v of bad) expect(await readLeadsAccessCookie(v, TOKEN)).toBeNull();
    expect(await readLeadsAccessCookie(good, TOKEN)).toEqual({ expiresAt: exp });
  });

  it('trailing segments after the signature are ignored (split takes the first two parts)', async () => {
    const exp = Date.now() + 60_000;
    const good = await createLeadsAccessCookie(TOKEN, exp);
    expect(await readLeadsAccessCookie(`${good}.extra`, TOKEN)).toEqual({ expiresAt: exp });
  });

  it('a value expiring exactly now is rejected', async () => {
    const exp = Date.now() - 1;
    expect(await readLeadsAccessCookie(await createLeadsAccessCookie(TOKEN, exp), TOKEN)).toBeNull();
  });
});

describe('segmentSlug', () => {
  it('comboToSlug defaults to general and handles empty/partial input', () => {
    expect(comboToSlug({})).toBe('general');
    expect(comboToSlug({ bookingStatus: null, productTier: 'LUXURY', geography: null })).toBe('general-luxury');
    expect(comboToSlug({ bookingStatus: 'ACTIVE_ENQUIRY', geography: 'INTERNATIONAL' })).toBe('active-enquiry-international');
  });

  it('slugToCombo is tolerant of junk, empties and unknown words', () => {
    expect(slugToCombo('')).toEqual({ bookingStatus: null, productTier: null, geography: null, label: 'General' });
    expect(slugToCombo('garbage-slug')).toMatchObject({ bookingStatus: null, label: 'General' });
    expect(slugToCombo('on-trip--luxury-')).toMatchObject({ bookingStatus: 'ON_TRIP', productTier: 'LUXURY' });
    expect(slugToCombo('general-local-xyz')).toMatchObject({ bookingStatus: null, geography: 'LOCAL', label: 'General — Local' });
    expect(slugToCombo('prospect-standard-international').label).toBe('Prospect — Standard — International');
  });

  it('is case-sensitive: upper-case slugs are not recognised', () => {
    expect(slugToCombo('ON-TRIP-LUXURY')).toMatchObject({ bookingStatus: null, productTier: null });
  });

  it('a status prefix without a dash boundary does not match (on-tripx)', () => {
    expect(slugToCombo('on-tripx').bookingStatus).toBeNull();
  });

  it('last tier/geo word wins when repeated', () => {
    expect(slugToCombo('general-luxury-standard-local-international')).toMatchObject({ productTier: 'STANDARD', geography: 'INTERNATIONAL' });
  });
});
