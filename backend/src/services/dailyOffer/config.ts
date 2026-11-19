/**
 * Daily offer email — settings.
 *
 * Every value can be changed from backend/.env without a code change. The job is
 * OFF unless DAILY_OFFER_ENABLED=true, so deploying this code changes nothing.
 */

import type { DailyOfferLabel, OfferAudience, OfferLinks } from './types.js';

const int = (v: string | undefined, d: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export interface DailyOfferConfig {
  audience: OfferAudience;
  enabled: boolean;
  segmentId: number;
  feedUrl: string;
  feedTimeoutMs: number;
  minFeedRows: number;
  minProducts: number;
  createAt: string;
  retryUntil: string;
  checkAt: string;
  sendAt: string;
  sendCheckAt: string;
  maxFxAgeHours: number;
  /** B2B only: portal links for every card and the button. null = the feed's product pages. */
  links: OfferLinks | null;
}

/**
 * Settings for one audience. 'b2c' is the original job and reads the DAILY_OFFER_* values
 * exactly as before. 'b2b' mirrors the B2C email of the day (same products, prices and
 * copy) with every link pointing at the B2B portal, sent earlier to the B2B segment. It
 * reads DAILY_OFFER_B2B_* and is OFF unless DAILY_OFFER_B2B_ENABLED=true.
 */
export function getDailyOfferConfig(env: NodeJS.ProcessEnv = process.env, audience: OfferAudience = 'b2c'): DailyOfferConfig {
  const shared = {
    feedUrl:        env.DAILY_OFFER_FEED_URL || 'https://data-projects-flax.vercel.app/api/enriched-feed?format=json',
    feedTimeoutMs:  int(env.DAILY_OFFER_FEED_TIMEOUT_MS, 5 * 60 * 1000),
    minFeedRows:    int(env.DAILY_OFFER_MIN_FEED_ROWS, 1500),
    minProducts:    int(env.DAILY_OFFER_MIN_PRODUCTS, 8),
    maxFxAgeHours:  int(env.DAILY_OFFER_MAX_FX_AGE_HOURS, 48),
  };
  if (audience === 'b2b') {
    return {
      ...shared,
      audience:       'b2b',
      enabled:        env.DAILY_OFFER_B2B_ENABLED === 'true',
      // custom_segments.id — 87 = "B2B - Subscribed Users Only" (the real send, default since
      // 2026-11-17); 95 = "B2C Testing Email Users" (trial inboxes) via DAILY_OFFER_B2B_SEGMENT_ID.
      segmentId:      int(env.DAILY_OFFER_B2B_SEGMENT_ID, 87),
      // The B2B email copies the B2C journey of the same day, so it is created after it:
      // attempts at :15 / :45 from createAt until retryUntil, waiting while B2C has no journey yet.
      createAt:       env.DAILY_OFFER_B2B_CREATE_AT || '09:15',
      retryUntil:     env.DAILY_OFFER_B2B_RETRY_UNTIL || '11:15',
      checkAt:        env.DAILY_OFFER_B2B_CHECK_AT || '11:45',
      sendAt:         env.DAILY_OFFER_B2B_SEND_AT || '12:00',
      sendCheckAt:    env.DAILY_OFFER_B2B_SEND_CHECK_AT || '13:30',
      // Product cards open their raynatours.com page (as in the B2C email) unless
      // DAILY_OFFER_B2B_PRODUCT_LINK sends them all to one URL; the button opens the B2B portal.
      // Giveaway / affiliate blocks stay in unless DAILY_OFFER_B2B_PROMOS=false.
      links: {
        productUrl: env.DAILY_OFFER_B2B_PRODUCT_LINK || null,
        ctaUrl:     env.DAILY_OFFER_B2B_LINK || 'https://www.raynab2b.com',
        ctaLabel:   env.DAILY_OFFER_B2B_CTA_LABEL || 'Click Here For B2B Rates',
        promos:     env.DAILY_OFFER_B2B_PROMOS !== 'false',
      },
    };
  }
  return {
    ...shared,
    audience:       'b2c',
    enabled:        env.DAILY_OFFER_ENABLED === 'true',
    // custom_segments.id — 95 = "B2C Testing Email Users" (testing), 86 = "B2C - Subscribed Users only".
    segmentId:      int(env.DAILY_OFFER_SEGMENT_ID, 95),
    // Dubai wall-clock times (HH:MM). Create retries every 30 min until the cut-off.
    createAt:       env.DAILY_OFFER_CREATE_AT || '09:00',
    retryUntil:     env.DAILY_OFFER_RETRY_UNTIL || '14:00',
    checkAt:        env.DAILY_OFFER_CHECK_AT || '15:45',
    sendAt:         env.DAILY_OFFER_SEND_AT || '16:00',
    sendCheckAt:    env.DAILY_OFFER_SEND_CHECK_AT || '17:30',   // were any emails sent? else alert the team
    links:          null,   // product pages from the feed, "Explore …" button per theme
  };
}

/** Audience of a saved daily-offer label — rows written before the B2B job have none. */
export function audienceOf(label: Pick<DailyOfferLabel, 'audience'> | null | undefined): OfferAudience {
  return label?.audience === 'b2b' ? 'b2b' : 'b2c';
}

// ── Dubai time helpers (UTC+4 all year, no daylight saving) ──
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** YYYY-MM-DD in Dubai for the given instant. */
export function dubaiDate(at: Date = new Date()): string {
  return new Date(at.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since Dubai midnight for the given instant. */
export function dubaiMinutes(at: Date = new Date()): number {
  const d = new Date(at.getTime() + DUBAI_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** The UTC instant of a Dubai wall-clock time on a Dubai date ("2026-11-01", "16:00"). */
export function dubaiInstant(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm.padStart(5, '0')}:00+04:00`);
}
