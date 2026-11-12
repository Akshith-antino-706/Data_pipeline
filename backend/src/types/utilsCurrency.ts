/** Types for src/utils/currency.ts (type-only module). */

/** AED → currency multipliers keyed by upper-case ISO code. */
export type FxRates = Record<string, number>;

/** fx_rates row (pg returns NUMERIC as string). */
export interface FxRateRow {
  currency: string;
  aed_to_currency: string | number;
}
