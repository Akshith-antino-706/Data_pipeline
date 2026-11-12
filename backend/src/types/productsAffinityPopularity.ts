/** Types for src/services/PopularityService.ts (type-only module). */

/** Hardcoded simulation/catalog row. */
export interface SimProduct {
  theme?: string;
  name: string;
  category: string;
  location: string;
  duration: string;
  price: string;
  image_url: string;
  product_url: string;
}

/** Normalized popular product (what the renderer consumes). */
export interface PopularProduct {
  product_id: string | number | null;
  name: string;
  category: string;
  location: string;
  duration: string;
  price: string;
  image_url: string;
  product_url: string;
  raw_payload?: unknown;
}

/** One row written to / read from popularity_snapshots. */
export interface PopularitySnapshotRow extends PopularProduct {
  journey_id: string | number;
  node_id: string;
  run_id: string;
  product_type: string;
  theme: string;
  position: number;
}

/** Row selected by getSnapshot(). */
export interface PopularitySnapshotDbRow {
  theme: string | null;
  position: number;
  product_id: string | null;
  name: string;
  category: string;
  location: string;
  duration: string;
  price: string;
  image_url: string;
  product_url: string;
}

export interface FetchTopProductsOpts {
  productType?: string;
  limit?: number;
  country?: string | null;
  theme?: string | null;
}

export interface SnapshotOpts {
  journeyId?: string | number;
  nodeId?: string;
  runId?: string;
  productType?: string;
  themes?: Array<string | null>;
  limit?: number;
  country?: string | null;
}

export interface GetSnapshotOpts {
  journeyId: string | number;
  nodeId: string;
  runId: string;
  productType: string;
}

/** Lenient item shape from the external popularity REST API. */
export interface RawPopularityItem {
  product_id?: string | number | null;
  id?: string | number | null;
  productId?: string | number | null;
  name?: string;
  title?: string;
  category?: string;
  type?: string;
  product_type?: string;
  location?: string;
  city?: string;
  country?: string;
  duration?: string;
  image_url?: string;
  image?: string;
  thumbnail?: string;
  product_url?: string;
  url?: string;
  link?: string;
  price?: string | number | null;
  sale_price?: string | number | null;
  price_aed?: string | number | null;
  starting_price?: string | number | null;
  currency?: string;
}

export interface RawPopularityResponse {
  products?: RawPopularityItem[];
  data?: RawPopularityItem[];
  items?: RawPopularityItem[];
}

/** Subset of an Anthropic Messages API content block that is read. */
export interface AnthropicContentBlock {
  type: string;
  name?: string;
  text?: string;
  input?: { query?: string };
  content?: unknown;
  citations?: unknown;
}

export interface AnthropicWebResult { url?: string; title?: string }
export interface AnthropicCitation { url?: string; title?: string; cited_text?: string }

export interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: Record<string, unknown> | null;
}
