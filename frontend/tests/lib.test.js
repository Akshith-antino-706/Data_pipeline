import { describe, it, expect } from 'vitest';
import { safeEqual, createLeadsAccessCookie, readLeadsAccessCookie } from '@/lib/leadsAccess';
import { comboToSlug, slugToCombo } from '@/lib/segmentSlug';
import { contactTypeColor, CONTACT_TYPES } from '@/lib/contactTypes';

describe('leadsAccess (S-A2)', () => {
  it('safeEqual compares exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('accepts its own cookie and rejects tampered / expired ones', async () => {
    const exp = Date.now() + 60_000;
    const cookie = await createLeadsAccessCookie('token-1', exp);
    expect(await readLeadsAccessCookie(cookie, 'token-1')).toEqual({ expiresAt: exp });
    expect(await readLeadsAccessCookie(cookie, 'other-token')).toBeNull();
    expect(await readLeadsAccessCookie(cookie.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), 'token-1')).toBeNull();
    const old = await createLeadsAccessCookie('token-1', Date.now() - 1);
    expect(await readLeadsAccessCookie(old, 'token-1')).toBeNull();
    expect(await readLeadsAccessCookie('', 'token-1')).toBeNull();
  });
});

describe('segmentSlug', () => {
  it('round-trips every real combo through its slug', () => {
    for (const bookingStatus of ['ON_TRIP', 'FUTURE_TRAVEL', 'ACTIVE_ENQUIRY', 'PAST_BOOKING', 'PAST_ENQUIRY', 'PROSPECT', null])
      for (const productTier of ['LUXURY', 'STANDARD', null])
        for (const geography of ['LOCAL', 'INTERNATIONAL', null]) {
          const combo = { bookingStatus, productTier, geography };
          expect(slugToCombo(comboToSlug(combo))).toMatchObject(combo);
        }
  });
  it('builds a readable label', () => {
    expect(slugToCombo('future-travel-luxury-local').label).toBe('Future Travel — Luxury — Local');
  });
});

describe('contactTypes', () => {
  it('has a colour for every type and a fallback', () => {
    for (const t of CONTACT_TYPES) expect(contactTypeColor(t)).toBeTruthy();
    expect(contactTypeColor('unknown')).toBeTruthy();
  });
});
