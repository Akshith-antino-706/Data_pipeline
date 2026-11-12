/** Types for src/utils/marketPlan.ts (type-only module). */

/** Contact fields read by resolveMarket (unified_contacts row or a partial of it). */
export interface MarketContact {
  market_plan?: string | null;
  currency_code?: string | null;
  mobile_country?: string | null;
  country?: string | null;
  is_indian?: boolean | string | null;
}

export interface MarketResolution {
  plan: string;
  currency: string;
}
