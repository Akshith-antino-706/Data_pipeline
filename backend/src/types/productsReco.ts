/** Types for RecommendationRankingService / RecommendationRenderer / CategoryPicksService (type-only module). */

import type { MarketResolution } from './utilsMarket.js';

/** Candidate product row (products table) fed to Claude. pg numeric → string. */
export interface RecoCandidateRow {
  product_id: number;
  name: string;
  category: string | null;
  city: string | null;
  country: string | null;
  image_url: string;
  url: string;
  sale_price: string | null;
  normal_price: string | null;
  page_description?: string | null;
}

/** Trending candidate row (CategoryPicksService) — COUNT comes back as string. */
export interface TrendingCandidateRow extends RecoCandidateRow {
  bookings_30d: string;
}

/** Parsed Claude JSON response. */
export interface ClaudePickResponse {
  product_ids: Array<number | string>;
  rationale?: string;
}

export interface ClaudeRankResult extends ClaudePickResponse {
  source: string;
}

/** Minimal shape of the Anthropic Messages API JSON. */
export interface AnthropicMessageJson {
  content?: Array<{ text?: string }>;
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  retries?: number;
}

export type RecommendationSource = 'claude' | 'fallback' | 'fallback_no_api_key';

export interface RankingResult {
  productIds: number[];
  source: RecommendationSource;
  candidates: number;
  rationale: string;
}

export interface RankOnceArgs {
  destinationCity: string;
  excludeProductId: string | number | null | undefined;
  topN: number;
}

export interface RankRecommendationsArgs {
  destinationCity?: string;
  excludeProductId?: string | number | null;
  topN?: number;
  journeyId?: string | number;
  nodeId?: string | number;
}

export interface ComputeForUserArgs {
  /** unified_contacts.id — the cron passes numbers, routes pass strings */
  unifiedId?: string | number;
  recommendationType?: string;
  topN?: number;
  cacheDays?: number;
}

export interface GetForUserArgs {
  unifiedId?: string | number;
  recommendationType?: string;
}

export interface UserRecommendationRow {
  unified_id: string | number;
  recommendation_type: string;
  based_on_booking_id: string | null;
  based_on_product_id: string | null;
  destination_city: string | null;
  product_ids: number[] | null;
  source: string | null;
  rationale: string | null;
  computed_at: Date;
  expires_at: Date;
}

export interface UserRecommendation {
  unifiedId: string | number;
  recommendationType: string;
  basedOnBookingId: string | null;
  basedOnProductId: string | null;
  destinationCity: string | null;
  productIds: number[];
  source: string | null;
  rationale: string | null;
  computedAt: Date;
  expiresAt: Date;
}

export interface CategoryCountRow {
  category: string;
  n: string;
}

export interface JourneyNodeRankingRow {
  ranking: RankingResult | null;
}

/** ── CategoryPicksService ── */
export type JourneyCategory = 'activities' | 'holidays' | 'cruises';

export interface DailyCategoryPicksRow {
  product_ids: number[] | null;
  source: string | null;
  rationale: string | null;
  computed_date: Date;
  computed_at: Date;
}

export interface CategoryPicks {
  category: string;
  productIds: number[];
  source: string | null;
  rationale: string | null;
  computedDate: Date;
  computedAt: Date;
}

/** ── RecommendationRenderer ── */
export interface MarketPriceEntry {
  sale_price?: number | string | null;
  price?: number | string | null;
}

export type MarketPrices = Record<string, MarketPriceEntry | undefined>;

export interface HydrateProductRow extends RecoCandidateRow {
  market_prices: MarketPrices | null;
}

export interface HydratedProduct {
  product_id: number;
  product_name: string;
  product_url: string;
  product_image: string;
  product_category: string;
  product_city: string;
  product_price: number | string;
  product_strike_price: number | string;
  product_discount_percent: number | string;
  product_currency: string;
  product_price_local: string;
  product_strike_price_local: string;
  product_rating: string;
  product_reviews: string;
}

export type RecoTemplateVars = Record<string, string | number | boolean | null | undefined>;

export interface RecoRankingInput {
  productIds?: Array<number | string>;
  product_ids?: Array<number | string>;
}

export interface RenderRecommendationArgs {
  templateHtml?: string;
  ranking?: RecoRankingInput | null;
  vars?: RecoTemplateVars;
  market?: MarketResolution | null;
}

export interface InjectPerUserArgs {
  templateHtml?: string;
  unifiedId?: string | number;
  recommendationType?: string;
  vars?: RecoTemplateVars;
  market?: MarketResolution | null;
}
