/**
 * GiveawayJourneyService — real-time entry into continuous "giveaway" / "affiliate" journeys.
 *
 * Mirror of GtmJourneyService.onEvent, but the trigger is an event TYPE from the RabbitMQ
 * feed instead of a GTM event name:
 *   giveaway  → participation | eligible | winner | loser
 *   affiliate → joined | coupon_assigned | commission_assigned | link_generated | card_offer_generated
 *
 * A journey here = journey_type='gtm', trigger_source='giveaway' OR 'affiliate',
 *   trigger_event='winner' (or a comma list like 'winner,loser').
 * The source is matched too, so the two feeds can safely share event-type names.
 *
 * Segment-gated (same as GTM): a user enters ONLY if they belong to the journey's
 * selected segment AND fired the giveaway type. Fan-out key = the giveaway eventId
 * (unique per message), so a user who fires 'winner' 10 times gets 10 entries → 10 sends.
 *
 * Reuses GtmJourneyService._isSegmentMember / _nextStep and ContinuousJourneyService.enter,
 * so the whole downstream engine (progression cron, send, advance) is unchanged.
 */
import db from '../config/database.js';
import type { GiveawayEventInput } from '../types/services_C.js';
import type { JourneyNode } from '../types/queueJobs.js';
import type { GtmJourneyFlowRow } from '../types/servicesGtmJourney.js';

class GiveawayJourneyService {
  /**
   * @param {{ giveawayType: string, unifiedId: number|string, eventId: string }} args
   */
  /**
   * Returns the number of giveaway journeys this contact is HANDLED by (active journey for this
   * type + segment member). The consumer uses this to decide whether to ALSO send the producer's
   * direct email: when ≥1 journey handles the contact, the journey owns the email and the direct
   * send is skipped (no duplicate). Eligibility is used (not "newly-created entry") so the count
   * is stable across RabbitMQ redeliveries.
   */
  static async onEvent({ giveawayType, unifiedId, eventId, source = 'GIVEAWAY' }: GiveawayEventInput) {
    if (!giveawayType || !unifiedId) return 0;

    // One code path, two feeds: a journey subscribes to its own source only, so an
    // affiliate 'joined' can never enrol someone into a giveaway journey or vice versa.
    const triggerSource = source === 'AFFILIATE' ? 'affiliate' : 'giveaway';
    const { rows: journeys } = await db.query<GtmJourneyFlowRow>(
      `SELECT journey_id, nodes, edges, custom_segment_id, segment_id, audience
         FROM journey_flows
        WHERE status = 'active' AND journey_type = 'gtm' AND trigger_source = $2
          AND trigger_event IS NOT NULL
          AND $1 = ANY(string_to_array(replace(trigger_event, ' ', ''), ','))
          AND (trigger_from_date IS NULL OR trigger_from_date <= NOW())`,
      [giveawayType, triggerSource]
    );
    if (!journeys.length) return 0;

    const { default: GtmJourneyService }       = await import('./GtmJourneyService.js');
    const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
    const itemKey = String(eventId ?? '_noitem');   // unique per giveaway event → per-event fan-out

    let handled = 0;
    for (const j of journeys) {
      try {
        // SEGMENT GUARD (identical to GTM): the trigger alone must NOT grant entry — the
        // user must ALSO be in the journey's selected segment. No segment → nobody enters.
        if (!(await GtmJourneyService._isSegmentMember(j, unifiedId))) continue;

        // First node after the trigger + its leading delay (reused GTM walk).
        const triggerNode = (j.nodes || []).find((n: JourneyNode) => n.type === 'trigger');
        const firstStep = triggerNode ? GtmJourneyService._nextStep(j.nodes || [], j.edges || [], triggerNode.id) : null;
        const firstNodeId = firstStep?.nodeId || (j.nodes || []).find((n: JourneyNode) => n.type === 'action')?.id || null;
        if (!firstNodeId) continue;

        const id = await ContinuousJourneyService.enter({
          journeyId: j.journey_id, unifiedId, itemId: itemKey, eventId,
          firstNodeId, entryDelayMs: firstStep ? firstStep.delayMs : 0,
        });
        // The contact is eligible for this journey → it owns the email (whether `id` is a new
        // entry or null because an idempotent re-entry already existed).
        handled++;
        if (id) console.log(`[GiveawayJourney ${j.journey_id}] entered uid=${unifiedId} event=${itemKey} @ ${firstNodeId} delay=${Math.round((firstStep?.delayMs||0)/1000)}s (${giveawayType})`);
      } catch (e) {
        console.error(`[GiveawayJourney ${j.journey_id}] onEvent failed: ${(e as Error).message}`);
      }
    }
    return handled;
  }
}

export default GiveawayJourneyService;
