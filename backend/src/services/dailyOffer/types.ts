/** Types for the daily offer email (src/services/dailyOffer). Type-only module. */

/** One market_prices row, in AED. A null/0 sale price means "no price for this market". */
export interface PlanPrice { price: number | null; sale: number | null }

/** market_prices plan key ('default' | 'IN' | 'SA' | 'AE') → price row. */
export type PlanPrices = Partial<Record<string, PlanPrice>>;

/** Feed row → the small product record the email uses (feed.ts normalizeProduct). */
export interface OfferProduct {
  key: string;
  productId: string;
  type: string;
  name: string;
  url: string;
  slug: string;
  image: string;
  country: string;
  city: string;
  category: string;
  available: boolean;
  rank: number | null;
  countryOrder: number | null;
  cityOrder: number | null;
  rankInCity: number | null;
  subtitle: string;
  prices: PlanPrices;
}

/** A validated feed. */
export interface FeedResult {
  products: OfferProduct[];
  generatedAt: string | undefined;
  marketPricesAt: string | undefined;
}

export interface FetchFeedOptions {
  url: string;
  timeoutMs?: number;
  minRows?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export type FetchFeedFn = (opts: FetchFeedOptions) => Promise<FeedResult>;

export type OfferTheme = 'visa' | 'holiday_multi' | 'holiday_single' | 'activities' | 'cruise';

export interface LoopSlot { loopDay: number; theme: OfferTheme; visaFrom?: number; visaTo?: number }

export interface OfferGroup { title: string; subtitle: string; products: OfferProduct[] }

/** What the picker hands to the template builder. */
export interface OfferPick {
  loopDay: number;
  theme: OfferTheme;
  themeName: string;
  subjectLead: string;
  groups: OfferGroup[];
  productKeys: string[];
  count: number;
  activityCursor?: number | null;
  missingFixedVisas?: string[];
}

/** What came before today, for the "fresh" rule and the activity country cursor. */
export interface PreviousPick { productKeys?: string[]; activityCursor?: number | null }

/** Compact product stored on the journey node — only what send time needs. */
export interface SnapshotProduct { key: string; name: string; prices: PlanPrices }

export interface SnapshotGroup { title: string; subtitle: string; keys: string[] }

/** journey email node data.dailyOffer — the day's label + product/price snapshot. */
export interface DailyOfferLabel {
  version: number;
  date: string;
  loopDay: number;
  theme: OfferTheme;
  themeName: string;
  status: 'created' | 'scheduled' | 'skipped';
  productKeys: string[];
  activityCursor: number | null;
  groups: SnapshotGroup[];
  products: SnapshotProduct[];
  feedGeneratedAt?: string;
  /** Which subject opening was used: the AI one, or the rule-based fallback and why. */
  subject?: { source: 'ai' | 'fallback'; reason: string | null; lead: string; standardLead: string };
  createdAt: string;
  checkedAt?: string;
  dropped?: string[];
  skipReason?: string;
}

/** A market to price for: feed plan + display currency. */
export interface OfferMarket { plan: string; currency: string }

/** Market after the FX safety rules, with the AED → currency rate. */
export interface EffectiveMarket { plan: string; currency: string; rate: number }

export interface OfferPrice { sale: number; strike: number | null; savePct: number; currency: string }

export interface RenderedOffer { html: string; subject: string; missing: string[]; currency: string; from: string }

export interface PreviewMarketDef extends OfferMarket { label: string }
