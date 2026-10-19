import { describe, it, expect } from 'vitest';
import defaultExport, { resolveMarket } from '../src/utils/marketPlan.js';
import type { MarketContact } from '../src/types/utilsMarket.js';

describe('resolveMarket', () => {
  it('blank contact / no arg -> default AED', () => {
    expect(resolveMarket()).toEqual({ plan: 'default', currency: 'AED' });
    expect(resolveMarket({})).toEqual({ plan: 'default', currency: 'AED' });
    expect(resolveMarket({ country: '  ', mobile_country: null })).toEqual({ plan: 'default', currency: 'AED' });
  });

  it.each<[MarketContact, string, string]>([
    [{ country: 'India' }, 'IN', 'INR'], [{ country: 'BHARAT' }, 'IN', 'INR'], [{ country: 'ind' }, 'IN', 'INR'],
    [{ is_indian: true, country: 'Saudi Arabia' }, 'IN', 'INR'],
    [{ country: 'KSA' }, 'SA', 'SAR'], [{ country: 'kingdom of saudi arabia' }, 'SA', 'SAR'],
    [{ country: 'U.A.E' }, 'AE', 'AED'], [{ country: 'u a e' }, 'AE', 'AED'], [{ country: 'Emirates' }, 'AE', 'AED'],
    [{ country: 'Singapore' }, 'default', 'SGD'], [{ country: 'gb' }, 'default', 'GBP'],
    [{ country: 'Narnia' }, 'default', 'AED'],
  ])('%j -> %s/%s', (c, plan, currency) => {
    expect(resolveMarket(c)).toEqual({ plan, currency });
  });

  it('mobile_country wins over country; country is the fallback', () => {
    expect(resolveMarket({ mobile_country: 'India', country: 'UAE' })).toEqual({ plan: 'IN', currency: 'INR' });
    expect(resolveMarket({ mobile_country: '', country: 'UAE' })).toEqual({ plan: 'AE', currency: 'AED' });
  });

  it('stored plan + currency win when both valid (currency upper-cased/trimmed)', () => {
    expect(resolveMarket({ market_plan: 'SA', currency_code: ' usd ', country: 'India' })).toEqual({ plan: 'SA', currency: 'USD' });
    expect(resolveMarket({ market_plan: 'default', currency_code: 'EUR' })).toEqual({ plan: 'default', currency: 'EUR' });
  });

  it.each<MarketContact>([
    { market_plan: 'sa', currency_code: 'SAR', country: 'India' },
    { market_plan: 'XX', currency_code: 'SAR', country: 'India' },
    { market_plan: 'SA', currency_code: 'SA', country: 'India' },
    { market_plan: 'SA', currency_code: 'SARR', country: 'India' },
    { market_plan: 'SA', currency_code: null, country: 'India' },
    { market_plan: null, currency_code: 'INR', country: 'India' },
  ])('invalid stored values %j fall back to derivation', (c) => {
    expect(resolveMarket(c)).toEqual({ plan: 'IN', currency: 'INR' });
  });

  it('is_indian false/null does not force India', () => {
    expect(resolveMarket({ is_indian: false, country: 'ksa' }).plan).toBe('SA');
    expect(resolveMarket({ is_indian: null }).plan).toBe('default');
  });

  // Suspected BUG (marketPlan.ts:39): only boolean true is honoured, but MarketContact.is_indian
  // allows strings and placeholderResolver treats 'true' as Indian — so 'true' is ignored here.
  it.fails('BUG: is_indian "true" (string) should resolve to IN', () => {
    expect(resolveMarket({ is_indian: 'true' })).toEqual({ plan: 'IN', currency: 'INR' });
  });

  it('default export matches', () => {
    expect(defaultExport.resolveMarket).toBe(resolveMarket);
  });
});
