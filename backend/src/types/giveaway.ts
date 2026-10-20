/**
 * Giveaway §3 message contract (as published by the producer to RabbitMQ / enqueued to BullMQ).
 * Fields are optional because validation runs on untrusted input; validate() checks the
 * required ones (version, id, type, to.email, subject, body).
 */
export type GiveawayType = 'participation' | 'eligible' | 'winner' | 'loser';

/**
 * Affiliate feed event types. The affiliate app publishes to the same exchange with routing
 * key `affiliate.email.<env>.<type>`; its messages carry DATA blocks, not a rendered email.
 */
export type AffiliateType = 'joined' | 'coupon_assigned' | 'commission_assigned' | 'link_generated' | 'card_offer_generated';

/** Which RabbitMQ feed a message came from (first segment of its routing key). */
export type GiveawayFeedSource = 'GIVEAWAY' | 'AFFILIATE';

/** The affiliate data block that accompanies each affiliate type. */
export type AffiliateBlockKey = 'coupon' | 'commission' | 'link' | 'cardOffer';

/** coupon.discounts[] entry (affiliate `joined` / `coupon_assigned`). */
export interface AffiliateCouponDiscount {
  value?: unknown;
  discountType?: unknown;
  maxDiscountValue?: unknown;
  maxDiscountCurrency?: unknown;
  amountCurrency?: unknown;
}

export interface AffiliateCoupon {
  couponId?: unknown;
  code?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  maxTotalRedemptions?: unknown;
  maxPerUser?: unknown;
  discounts?: AffiliateCouponDiscount[];
}

export interface AffiliateCommission {
  ratePercent?: unknown;
  previousRatePercent?: unknown;
  effectiveFrom?: unknown;
}

export interface AffiliateLink {
  linkId?: unknown;
  slug?: unknown;
  trackingUrl?: unknown;
  destinationUrl?: unknown;
  campaignSource?: unknown;
  campaignMedium?: unknown;
  campaignName?: unknown;
}

export interface AffiliateCardOffer {
  offerId?: unknown;
  title?: unknown;
  subTitle?: unknown;
  code?: unknown;
  bankName?: unknown;
  discount?: unknown;
  discountType?: unknown;
  minOrderValue?: unknown;
  maxDiscountCap?: unknown;
  currency?: unknown;
  amountCurrency?: unknown;
  validUntil?: unknown;
}

export interface GiveawayRecipient {
  email?: string;
  name?: string;
}

export interface GiveawayEventData {
  user?: { name?: unknown };
  giveaway?: { title?: unknown; image?: unknown; mechanic?: unknown };
  prize?: { name?: unknown; image?: unknown; type?: unknown; value?: unknown };
  winner?: { rank?: unknown; code?: unknown };
  offer?: { name?: unknown; code?: unknown; expiry?: unknown };
  participant?: { position?: unknown; points?: unknown };
}

export interface GiveawayMessage {
  version?: number;
  id?: string | number;
  type?: string;
  tenantId?: string | number;
  giveawayId?: string | number;
  to?: GiveawayRecipient;
  subject?: string;
  body?: string;
  bodyFormat?: string;
  createdAt?: string;
  data?: GiveawayEventData;
  // ── AFFILIATE feed (top-level blocks; exactly one is present, selected by `type`) ──
  userTenantId?: string | number;
  coupon?: AffiliateCoupon;
  commission?: AffiliateCommission;
  link?: AffiliateLink;
  cardOffer?: AffiliateCardOffer;
}

export type GiveawayValidation = { ok: true } | { ok: false; reason: string };

/** Return value of the BullMQ giveaway worker job processor. */
export interface GiveawayJobResult {
  dropped?: boolean;
  reason?: string;
  duplicate?: boolean;
  logged?: boolean;
}

/**
 * ioredis `SET key value NX EX seconds`. Redis accepts NX before EX, but ioredis' overloads
 * only list the EX-then-NX order, so the call sites assert to this signature.
 */
export type RedisSetNxEx = (key: string, value: string, nx: 'NX', ex: 'EX', seconds: number) => Promise<'OK' | null>;
