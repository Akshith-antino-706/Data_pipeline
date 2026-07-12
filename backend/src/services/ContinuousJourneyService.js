import db from '../config/database.js';
import { enqueueGtmJourney } from './queue/index.js';
import GtmJourneyService from './GtmJourneyService.js';

/**
 * CONTINUOUS journey engine — the "conveyor belt".
 *
 * Per-user state lives in gtm_journey_entries (one row per journey×user×item). Users
 * enter anytime (real-time onEvent or the start fan-out or the status scan); a 1-min
 * cron (processDue) fires each row's current node when next_fire_at is due; after a
 * successful send the worker calls advance() to move the row to the next node (after
 * any wait) or complete it. The journey itself never completes — only rows do.
 *
 * Reuses GtmJourneyService._nextStep / _waitMs (flow walk + wait durations) and the
 * gtm-journey BullMQ worker (render + send). Exit conditions (unsubscribe + per-item
 * purchase) are re-checked at every node.
 */
class ContinuousJourneyService {
  static get _batch() { return parseInt(process.env.CONTINUOUS_BATCH || '500'); }

  /**
   * ENTRY — put a (journey, user, item) onto the belt. Idempotent: the UNIQUE
   * (journey,user,item) constraint + ON CONFLICT means re-entry/duplicate events are
   * no-ops. Returns the new entry id, or null if it already existed.
   */
  static async enter({ journeyId, unifiedId, itemId = '_noitem', eventId = null, serviceType = null, firstNodeId, entryDelayMs = 0 }) {
    if (!journeyId || !unifiedId || !firstNodeId) return null;
    const fireAt = new Date(Date.now() + Math.max(0, entryDelayMs));
    const { rows } = await db.query(
      `INSERT INTO gtm_journey_entries
         (journey_id, unified_id, item_id, current_node_id, status, service_type, entered_at, next_fire_at, last_event_id)
       VALUES ($1, $2, $3, $4, 'active', $5, NOW(), $6, $7)
       ON CONFLICT (journey_id, unified_id, item_id) DO NOTHING
       RETURNING id`,
      [journeyId, unifiedId, String(itemId), firstNodeId, serviceType, fireAt, eventId]
    );
    return rows[0]?.id || null;
  }

  /**
   * PROGRESSION CRON (every 1 min). Fire all due rows of active continuous journeys:
   * re-check exit, then enqueue the current node's send job. Advancing happens in the
   * worker after a successful send (so failures retry without skipping a node).
   */
  static async processDue() {
    // ATOMIC CLAIM: stamp last_enqueued_at on due rows in a single UPDATE…RETURNING.
    // The inner FOR UPDATE SKIP LOCKED + atomic stamp means two overlapping cron ticks
    // (or two backend instances) can NEVER claim the same row → no double-send.
    // A row is reclaimable only once advance() clears last_enqueued_at (next node due),
    // or after 10 min with no advance (failed send → retry).
    const { rows } = await db.query(
      `UPDATE gtm_journey_entries e
       SET last_enqueued_at = NOW(), updated_at = NOW()
       WHERE e.id IN (
         SELECT e2.id FROM gtm_journey_entries e2
         JOIN journey_flows j2 ON j2.journey_id = e2.journey_id
         WHERE e2.status = 'active'
           AND (e2.next_fire_at IS NULL OR e2.next_fire_at <= NOW())
           AND (e2.last_enqueued_at IS NULL OR e2.last_enqueued_at <= NOW() - INTERVAL '10 minutes')
           AND j2.status = 'active' AND j2.journey_type = 'gtm'
         ORDER BY e2.next_fire_at NULLS FIRST
         LIMIT $1
         FOR UPDATE OF e2 SKIP LOCKED
       )
       RETURNING e.id, e.journey_id, e.unified_id, e.item_id, e.current_node_id, e.last_event_id`,
      [this._batch]
    );
    if (!rows.length) return { due: 0, enqueued: 0, exited: 0 };

    // Rows are already claimed (last_enqueued_at stamped atomically above). Now exit-check + enqueue.
    let enqueued = 0, exited = 0;
    for (const e of rows) {
      const exit = await this._exitReason(e.unified_id, e.item_id);
      if (exit) {
        await db.query(`UPDATE gtm_journey_entries SET status='exited', exit_reason=$2, next_fire_at=NULL, updated_at=NOW() WHERE id=$1`, [e.id, exit]);
        exited++; continue;
      }
      await enqueueGtmJourney({
        entryId: e.id, journeyId: e.journey_id, unifiedId: e.unified_id,
        eventId: e.last_event_id, nodeId: e.current_node_id, itemId: e.item_id,
      }, 0);
      enqueued++;
    }
    if (enqueued || exited) console.log(`[Continuous] processDue: due=${rows.length} enqueued=${enqueued} exited=${exited}`);
    return { due: rows.length, enqueued, exited };
  }

  /**
   * ADVANCE — called by the worker after a node's email sends successfully.
   * Walks to the next action node (summing wait-node delays); sets next_fire_at so the
   * cron fires it later, or completes the row at the end of the sequence.
   */
  static async advance(entryId, journeyId, currentNodeId) {
    const { rows: [jf] } = await db.query('SELECT nodes, edges FROM journey_flows WHERE journey_id = $1', [journeyId]);
    const next = GtmJourneyService._nextStep(jf?.nodes || [], jf?.edges || [], currentNodeId);
    if (next?.nodeId) {
      await db.query(
        `UPDATE gtm_journey_entries
         SET current_node_id=$2, next_fire_at=NOW() + ($3 || ' milliseconds')::interval,
             last_enqueued_at=NULL, updated_at=NOW()
         WHERE id=$1`,
        [entryId, next.nodeId, String(Math.round(next.delayMs))]
      );
      return { advancedTo: next.nodeId, delayMs: next.delayMs };
    }
    await db.query(
      `UPDATE gtm_journey_entries SET status='completed', exit_reason='completed', next_fire_at=NULL, updated_at=NOW() WHERE id=$1`,
      [entryId]
    );
    return { completed: true };
  }

  /** Exit conditions re-checked at every node: unsubscribe + per-item purchase. */
  static async _exitReason(unifiedId, itemId) {
    const { rows: [c] } = await db.query('SELECT email_unsubscribe FROM unified_contacts WHERE id = $1', [unifiedId]);
    if (String(c?.email_unsubscribe || '').toLowerCase() === 'yes') return 'unsubscribed';
    if (itemId && itemId !== '_noitem') {
      const { rows: [b] } = await db.query(
        `SELECT 1 FROM gtm_events WHERE unified_id = $1 AND event_name = 'purchase'
           AND COALESCE(raw_payload->>'itemId','') = $2 LIMIT 1`,
        [unifiedId, String(itemId)]
      );
      if (b) return 'purchased';
    }
    return null;
  }
}

export default ContinuousJourneyService;
