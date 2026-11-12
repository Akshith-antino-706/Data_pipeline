import { describe, it, expect } from 'vitest';
import { safeNext, loginUrlFor, DEFAULT_AFTER_LOGIN } from '@/lib/loginNext';

describe('safeNext — where to go after signing in', () => {
  it('keeps a same-site path, with its query', () => {
    expect(safeNext('/journeys/279')).toBe('/journeys/279');
    expect(safeNext('/journeys?status=draft&sort=newest')).toBe('/journeys?status=draft&sort=newest');
  });

  it('falls back to the dashboard when there is nothing to return to', () => {
    expect(safeNext(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('/login')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('/')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('/landing')).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('never sends the user off-site (open-redirect guard)', () => {
    expect(safeNext('https://evil.example/phish')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('//evil.example/phish')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('/\\evil.example')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNext('journeys')).toBe(DEFAULT_AFTER_LOGIN);
  });
});

describe('loginUrlFor — the /login link that remembers the page', () => {
  it('encodes the page into ?next=', () => {
    expect(loginUrlFor('/journeys/279?tab=flow')).toBe('/login?next=%2Fjourneys%2F279%3Ftab%3Dflow');
  });

  it('is a plain /login when there is nothing worth returning to', () => {
    expect(loginUrlFor('/')).toBe('/login');
    expect(loginUrlFor('/login')).toBe('/login');
    expect(loginUrlFor('https://evil.example')).toBe('/login');
  });
});
