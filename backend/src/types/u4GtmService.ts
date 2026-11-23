/** Row shapes for GTMService / GiveawayJourneyService queries. */

export interface U4IdRow { id: number }
export interface U4UnifiedIdRow { unified_id: number }
export interface U4ProductImageCurrencyRow { image_url: string | null; currency: string | null }

/** gtm_events row (RETURNING *); only event_id is read here, the rest is passed through. */
export interface U4GtmEventRow extends Record<string, unknown> { event_id: number }

/** Pass-through rows returned to API callers as-is. */
export type U4PassThroughRow = Record<string, unknown>;
