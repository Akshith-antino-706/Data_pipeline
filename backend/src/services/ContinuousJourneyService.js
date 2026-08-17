import db from '../config/database.js';
import { enqueueGtmJourney } from './queue/index.js';
import GtmJourneyService from './GtmJourneyService.js';
import ChatHeadV1Service from './ChatHeadV1Service.js';

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
    if (!rows.length) return { due: 0, enqueued: 0, exited: 0, waBroadcasts: 0, waSent: 0 };

    // ── Split the claimed rows by channel of their CURRENT node ──────────────
    // WhatsApp action nodes are BATCHED: all due recipients of the same (journey,
    // node, ChatHead channel, template) go into ONE .data-file broadcast — not one
    // broadcast per recipient. Everything else (email, etc.) keeps the per-entry
    // BullMQ worker path (each email is rendered per user).
    const journeyIds = [...new Set(rows.map(r => r.journey_id))];
    const { rows: flows } = await db.query(
      'SELECT journey_id, nodes FROM journey_flows WHERE journey_id = ANY($1::int[])', [journeyIds]
    );
    const nodeMapOf = {};
    for (const f of flows) nodeMapOf[f.journey_id] = Object.fromEntries((f.nodes || []).map(n => [n.id, n]));

    const waGroups = new Map(); // journeyId|nodeId|waCh|waTpl → { node, waCh, waTpl, entries[] }
    const others = [];
    for (const e of rows) {
      const node = nodeMapOf[e.journey_id]?.[e.current_node_id];
      if (node?.type === 'action' && String(node.data?.channel || '').toLowerCase() === 'whatsapp') {
        const waCh = node.data?.waChannelId, waTpl = node.data?.waTemplateId;
        const key = `${e.journey_id}|${e.current_node_id}|${waCh}|${waTpl}`;
        if (!waGroups.has(key)) waGroups.set(key, { node, waCh, waTpl, entries: [] });
        waGroups.get(key).entries.push(e);
      } else {
        others.push(e);
      }
    }

    // Non-WhatsApp: exit-check + enqueue per entry (unchanged behaviour).
    let enqueued = 0, exited = 0;
    for (const e of others) {
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

    // WhatsApp: ONE broadcast per group (all recipients in a single .data file).
    let waBroadcasts = 0, waSent = 0;
    for (const grp of waGroups.values()) {
      const r = await this._sendWhatsAppGroup(grp);
      waBroadcasts += r.broadcasts; waSent += r.sent; exited += r.exited;
    }

    if (enqueued || exited || waSent) console.log(`[Continuous] processDue: due=${rows.length} enqueued=${enqueued} waSent=${waSent} (${waBroadcasts} broadcast${waBroadcasts === 1 ? '' : 's'}) exited=${exited}`);
    return { due: rows.length, enqueued, exited, waBroadcasts, waSent };
  }

  /**
   * Send ONE ChatHead broadcast for a group of due entries all sitting on the SAME
   * WhatsApp node (same channel + template) — the whole group goes into a single
   * .data file, then each entry is logged (whatsapp_send_log, source=gtm_journey)
   * and advanced. This is the continuous-engine analogue of the fixed engine's
   * _sendWhatsAppBatch; it's what stops the "one broadcast per recipient" storm.
   */
  static async _sendWhatsAppGroup({ node, waCh, waTpl, entries }) {
    const journeyId = entries[0].journey_id, nodeId = node.id;
    let exited = 0;
    const logEvent = (entryId, type, details) => db.query(
      `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details) VALUES ($1,$2,$3,'whatsapp',$4)`,
      [entryId, nodeId, type, JSON.stringify(details || {})]
    ).catch(() => {});

    // Batch-fetch contacts once; then exit-check + opt-out + validity per entry.
    const uids = [...new Set(entries.map(e => e.unified_id))];
    const { rows: cs } = await db.query(
      'SELECT id, name, mobile, wa_unsubscribe FROM unified_contacts WHERE id = ANY($1::bigint[])', [uids]
    );
    const cMap = Object.fromEntries(cs.map(c => [c.id, c]));

    const valid = [];
    for (const e of entries) {
      const exit = await this._exitReason(e.unified_id, e.item_id);
      if (exit) {
        await db.query(`UPDATE gtm_journey_entries SET status='exited', exit_reason=$2, next_fire_at=NULL, updated_at=NOW() WHERE id=$1`, [e.id, exit]);
        exited++; continue;
      }
      const c = cMap[e.unified_id] || {};
      if (String(c.wa_unsubscribe || '').toLowerCase() === 'yes') { await this.advance(e.id, journeyId, nodeId); continue; }
      const phone = String(c.mobile || '').replace(/\D/g, '');
      if (phone.length < 10 || !waCh || !waTpl) {
        await logEvent(e.id, 'action_blocked', { reason: phone.length < 10 ? 'no_mobile' : 'missing_chathead_config' });
        await this.advance(e.id, journeyId, nodeId);
        continue;
      }
      valid.push({ e, c, phone });
    }
    if (!valid.length) return { broadcasts: 0, sent: 0, exited };

    // ── ONE ChatHead broadcast for the whole group ──
    let result;
    try {
      result = await ChatHeadV1Service.sendBroadcast({
        contacts:     valid.map(v => ({ phone: v.phone, name: v.c.name || '' })),
        channelId:    parseInt(waCh),
        channelName:  node.data?.waChannelName || null,
        templateId:   parseInt(waTpl),
        templateName: node.data?.waTemplateName || null,
        name:         `gtm journey ${journeyId} ${nodeId} (${valid.length})`,
        sendTime:     new Date(Date.now() + 60 * 1000),
      });
    } catch (err) { result = { success: false, error: err.message }; }

    const ok      = !!result?.success;
    const bcastId = result?.broadcast?.id ?? null;
    const extId   = result?.broadcast?.chatheadBroadcastId != null ? String(result.broadcast.chatheadBroadcastId) : null;

    // Per-recipient log + advance (each entry independent). Advance on failure too —
    // retrying would re-broadcast (dup sends); the failure is recorded instead.
    for (const v of valid) {
      await db.query(
        `INSERT INTO whatsapp_send_log
           (unified_id, phone, contact_name, channel_id, template_id, template_name,
            journey_id, node_id, broadcast_id, external_id, status, source, error, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'gtm_journey',$12,
                 CASE WHEN $11='sent' THEN NOW() ELSE NULL END)`,
        [v.c.id, v.phone, v.c.name || null, parseInt(waCh), parseInt(waTpl),
         node.data?.waTemplateName || null, journeyId, nodeId, bcastId, extId,
         ok ? 'sent' : 'failed', ok ? null : String(result?.error || 'broadcast failed').slice(0, 500)]
      ).catch(() => {});
      await logEvent(v.e.id, ok ? 'action_sent' : 'action_failed', { channel: 'whatsapp', bulk: true, broadcastId: extId, recipients: valid.length });
      await this.advance(v.e.id, journeyId, nodeId);
    }
    console.log(`[Continuous] WhatsApp BULK broadcast journey=${journeyId} node=${nodeId} recipients=${valid.length} status=${ok ? 'sent' : 'FAILED'} chId=${extId || '-'}`);
    return { broadcasts: 1, sent: valid.length, exited };
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
