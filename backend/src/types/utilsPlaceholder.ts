/** Types for src/utils/placeholderResolver.ts (type-only module). */

/** A primitive value that can land in a template variable. */
export type PlaceholderScalar = string | number | boolean | null | undefined;

/** One ecommerce data-layer item (raw_payload.ecommerceData.items[n]). */
export interface EcomItem {
  item_name?: PlaceholderScalar;
  item_id?: PlaceholderScalar;
  image_url?: PlaceholderScalar;
  currency?: PlaceholderScalar;
  city?: PlaceholderScalar;
  adult_count?: PlaceholderScalar;
  children_count?: PlaceholderScalar;
  booking_date?: PlaceholderScalar;
  selected_date?: PlaceholderScalar;
  price?: PlaceholderScalar;
  item_url?: PlaceholderScalar;
  url?: PlaceholderScalar;
  [key: string]: unknown;
}

/** raw_payload.ecommerceData / raw_payload.ecommerce */
export interface EcomRoot {
  items?: EcomItem[];
  currency?: PlaceholderScalar;
  value?: PlaceholderScalar;
  coupon?: PlaceholderScalar;
  [key: string]: unknown;
}

/** GTM event raw_payload (or a node's templateVariables). Only the fields read are typed. */
export interface PlaceholderPayload {
  ecommerceData?: EcomRoot | null;
  ecommerce?: EcomRoot | null;
  name?: PlaceholderScalar;
  email?: PlaceholderScalar;
  contact_number?: PlaceholderScalar;
  d?: PlaceholderScalar;
  img?: PlaceholderScalar;
  city?: PlaceholderScalar;
  country?: PlaceholderScalar;
  id?: PlaceholderScalar;
  pageUrl?: PlaceholderScalar;
  transactionId?: PlaceholderScalar;
  timestamp?: PlaceholderScalar;
  itemUrl?: PlaceholderScalar;
  item_url?: PlaceholderScalar;
  url?: PlaceholderScalar;
  ctaUrl?: PlaceholderScalar;
  cta_url?: PlaceholderScalar;
  productUrl?: PlaceholderScalar;
  product_url?: PlaceholderScalar;
  pageTitle?: PlaceholderScalar;
  eventName?: PlaceholderScalar;
  journeyId?: PlaceholderScalar;
  nodeId?: PlaceholderScalar;
  itemName?: PlaceholderScalar;
  itemId?: PlaceholderScalar;
  imageUrl?: PlaceholderScalar;
  itemCategory?: PlaceholderScalar;
  referrer?: PlaceholderScalar;
  currency?: PlaceholderScalar;
  paymentType?: PlaceholderScalar;
  tax?: PlaceholderScalar;
  contentType?: PlaceholderScalar;
  clickLocation?: PlaceholderScalar;
  shareMethod?: PlaceholderScalar;
  emailAddress?: PlaceholderScalar;
  phoneNumber?: PlaceholderScalar;
  whatsappNumber?: PlaceholderScalar;
  formName?: PlaceholderScalar;
  source?: PlaceholderScalar;
  leadType?: PlaceholderScalar;
  eventValue?: PlaceholderScalar;
  productContext?: PlaceholderScalar;
  productInterest?: PlaceholderScalar;
  errorCode?: PlaceholderScalar;
  errorMessage?: PlaceholderScalar;
  utmCampaign?: PlaceholderScalar;
  utmSource?: PlaceholderScalar;
  selectedDate?: PlaceholderScalar;
  [key: string]: unknown;
}

/** unified_contacts row (or ad-hoc contact object) — fields read by the resolver. */
export interface PlaceholderContact {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  d?: string | null;
  img?: string | null;
  city?: string | null;
  country?: string | null;
  is_indian?: boolean | string | null;
  geography?: string | null;
  booking_status?: string | null;
  product_tier?: string | null;
  segments?: string[] | string | null;
}

/** gtm_events row — fields read by the resolver. */
export interface PlaceholderEvent {
  page_url?: string | null;
  created_at?: Date | string | number | null;
  page_title?: string | null;
  event_name?: string | null;
  event_id?: string | number | null;
  journey_id?: string | number | null;
  node_id?: string | null;
  raw_payload?: PlaceholderPayload | null;
}

/** Booking-affinity vars (services/affinityVars.js). */
export type PlaceholderAffinity = Record<string, string | null | undefined>;

export interface PlaceholderContext {
  contact?: PlaceholderContact | null;
  event?: PlaceholderEvent | null;
  payload?: PlaceholderPayload | null;
  affinity?: PlaceholderAffinity | null;
}

/** Resolved UPPER_SNAKE (or lowercase .data) variable map. */
export type PlaceholderValues = Record<string, PlaceholderScalar>;
