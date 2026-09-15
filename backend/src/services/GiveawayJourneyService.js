/**
 * GiveawayJourneyService — real-time entry into continuous "giveaway" journeys.
 *
 * Mirror of GtmJourneyService.onEvent, but the trigger is a giveaway event TYPE
 * (participation | eligible | winner | loser) instead of a GTM event name.
 *
 * A giveaway journey = journey_type='gtm', trigger_source='giveaway',
 *   trigger_event='winner' (or a comma list like 'winner,loser').
 *
 * Segment-gated (same as GTM): a user enters ONLY if they belong to the journey's
 * selected segment AND fired the giveaway type. Fan-out key = the giveaway eventId
 * (unique per message), so a user who fires 'winner' 10 times gets 10 entries → 10 sends.
 *
 * Reuses GtmJourneyService._isSegmentMember / _nextStep and ContinuousJourneyService.enter,
 * so the whole downstream engine (progression cron, send, advance) is unchanged.
 */
import db from '../config/database.js';

class GiveawayJourneyService {
  /**
   * @param {{ giveawayType: string, unifiedId: number|string, eventId: string }} args
   */
  static async onEvent({ giveawayType, unifiedId, eventId }) {
    if (!giveawayType || !unifiedId) return;

    const { rows: journeys } = await db.query(
      `SELECT journey_id, nodes, edges, custom_segment_id, segment_id, audience
         FROM journey_flows
        WHERE status = 'active' AND journey_type = 'gtm' AND trigger_source = 'giveaway'
          AND trigger_event IS NOT NULL
          AND $1 = ANY(string_to_array(replace(trigger_event, ' ', ''), ','))
          AND (trigger_from_date IS NULL OR trigger_from_date <= NOW())`,
      [giveawayType]
    );
    if (!journeys.length) return;

    const { default: GtmJourneyService }       = await import('./GtmJourneyService.js');
    const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
    const itemKey = String(eventId ?? '_noitem');   // unique per giveaway event → per-event fan-out

    for (const j of journeys) {
      try {
        // SEGMENT GUARD (identical to GTM): the trigger alone must NOT grant entry — the
        // user must ALSO be in the journey's selected segment. No segment → nobody enters.
        if (!(await GtmJourneyService._isSegmentMember(j, unifiedId))) continue;

        // First node after the trigger + its leading delay (reused GTM walk).
        const triggerNode = (j.nodes || []).find(n => n.type === 'trigger');
        const firstStep = triggerNode ? GtmJourneyService._nextStep(j.nodes || [], j.edges || [], triggerNode.id) : null;
        const firstNodeId = firstStep?.nodeId || (j.nodes || []).find(n => n.type === 'action')?.id || null;
        if (!firstNodeId) continue;

        const id = await ContinuousJourneyService.enter({
          journeyId: j.journey_id, unifiedId, itemId: itemKey, eventId,
          firstNodeId, entryDelayMs: firstStep ? firstStep.delayMs : 0,
        });
        if (id) console.log(`[GiveawayJourney ${j.journey_id}] entered uid=${unifiedId} event=${itemKey} @ ${firstNodeId} delay=${Math.round((firstStep?.delayMs||0)/1000)}s (${giveawayType})`);
      } catch (e) {
        console.error(`[GiveawayJourney ${j.journey_id}] onEvent failed: ${e.message}`);
      }
    }
  }
}

export default GiveawayJourneyService;
