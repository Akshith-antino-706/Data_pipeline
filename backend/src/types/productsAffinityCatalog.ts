/** Types for src/services/ProductAffinityService.ts and ProductService.ts (type-only module). */

/** One record from the enriched-feed API. Values are coerced by _txt/_num/... so stay unknown. */
export type EnrichedFeedProduct = Record<string, unknown>;

export interface EnrichedFeedResponse {
  products?: EnrichedFeedProduct[];
}

export interface ProductDetailsResponse {
  title?: string;
  description?: string;
}

/** user_product_affinity.* joined with a few products columns (getUserAffinity). */
export interface UserAffinityRow {
  unified_id: string;
  product_id: number | null;
  product_name: string;
  product_category: string | null;
  product_url: string | null;
  view_count: number;
  cart_count: number;
  checkout_count: number;
  purchase_count: number;
  wishlist_count: number;
  affinity_score: string | number;
  sale_price: string | null;
  image_url: string | null;
  product_page_url: string | null;
  city: string | null;
  type: string | null;
  [key: string]: unknown;
}

/** products row subset used for recommendations. */
export interface ProductRecRow {
  product_id: number;
  name: string;
  type: string | null;
  category: string | null;
  sale_price: string | null;
  city: string | null;
  url: string | null;
  image_url: string | null;
}

/** Product from the all-products API (ProductService). */
export interface CatalogProduct {
  productId: number;
  name: string;
  item_group_id: string;
  salePrice: number;
  normalPrice: number;
  image?: string;
  city?: string;
  url?: string;
  [key: string]: unknown;
}

export interface CatalogProductsResponse {
  success?: boolean;
  products?: CatalogProduct[];
}

export interface CatalogFilters {
  category?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  search?: string;
}

export interface CatalogCategory {
  category: string;
  count: number;
  minPrice: number;
  maxPrice: number;
}

export interface ProductEmailHtmlOpts {
  products: CatalogProduct[];
  heading?: string;
  subheading?: string;
  ctaText?: string;
  ctaUrl?: string;
  couponCode?: string;
  segmentLabel?: string;
}

export interface ProductWAMessageOpts {
  products: CatalogProduct[];
  intro?: string;
  couponCode?: string;
}
