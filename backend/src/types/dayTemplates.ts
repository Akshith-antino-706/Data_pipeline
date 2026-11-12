/**
 * Shared types for the Day-1..7 journey email templates (DataService /
 * RankingService / Renderer triples) and VisaRankingService.
 * Type-only module: nothing here exists at runtime.
 */

/** unified_contacts.unified_id (or any id used as UTM `rid`). */
export type ContactId = string | number | null | undefined;
export type JourneyRef = string | number | null | undefined;

/** Optional journey/node ids appended to tracked links. */
export interface UtmOptions {
  journeyId?: JourneyRef;
  nodeId?: JourneyRef;
}

/** Common input for the build*Data() functions. */
export interface BuildDataArgs<R> {
  contactId?: ContactId;
  ranking: R;
  journeyId?: JourneyRef;
  nodeId?: JourneyRef;
}

/** A marketing destination entry in the in-file catalogs. */
export interface DestinationConfig {
  name: string;
  image: string;
  default_link: string;
  productSearch?: string[];
}

/** Card shape rendered into a grid (name/image/link). */
export interface CardItem {
  name: string;
  image: string;
  link: string;
}

export interface RatingEntry {
  platform: string;
  logo: string;
  stars: string;
  rating: string;
  reviews: string;
  styles: { border: string; bg: string; starColor: string };
}

// ── Claude Messages API ────────────────────────────────────────────────────

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface ClaudeMessageResponse {
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
  model?: string;
}

export interface ClaudeTool {
  type: string;
  name: string;
  max_uses?: number;
  [key: string]: unknown;
}

export interface ClaudeRequestBody {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: string;
  messages: { role: string; content: string }[];
  tools?: ClaudeTool[];
}

export interface ClaudeCallArgs {
  system: string;
  user: string;
  model?: string;
  useWebSearch?: boolean;
}

/** JSON object parsed out of Claude's final text block (shape validated by caller). */
export interface ClaudeParsedJson {
  [key: string]: unknown;
  rationale?: string;
  trending_themes?: string[];
  safety_notes?: string[];
}

export interface ClaudeCallResult {
  parsed: ClaudeParsedJson;
  usage: ClaudeUsage | undefined;
  model: string | undefined;
  webSearchCalls: number;
}

/** Options accepted by the public rank*() functions. */
export interface RankOptions {
  modelOverride?: string;
  useWebSearch?: boolean;
}

// ── DB rows ────────────────────────────────────────────────────────────────
// Type aliases (not interfaces) so they stay assignable to Record<string, unknown>.

/** Row from the `products` table (columns vary by SELECT; all but id/name optional). */
export type ProductRow = {
  product_id: number;
  name: string;
  type?: string | null;
  category?: string | null;
  city?: string | null;
  country?: string | null;
  sale_price?: string | number | null;
  normal_price?: string | number | null;
  currency?: string | null;
  url?: string | null;
  image_url?: string | null;
  page_description?: string | null;
};

/** Row from the `visa_products` table (columns vary by SELECT). */
export type VisaProductRow = {
  key: string;
  name: string;
  country_label?: string | null;
  flag_unicode?: string | null;
  flag_url?: string | null;
  types_html?: string | null;
  details_html?: string | null;
  status?: string | null;
  image_url?: string | null;
  default_link?: string | null;
  categories?: string[] | null;
  region?: string | null;
  sort_order?: number | null;
};

/** Slim product row offered to Claude as a ranking candidate. */
export type ProductCandidate = Pick<ProductRow, 'product_id' | 'name' | 'category' | 'type' | 'city' | 'country'>;
