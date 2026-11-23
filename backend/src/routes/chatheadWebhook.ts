/**
 * ChatHead → one-to-one WhatsApp message status webhook.
 * Mounted at /api/webhooks/chathead (public — /webhooks/* needs no login; the token below is
 * the only gate, because the events carry no signature).
 *
 *   POST /api/webhooks/chathead/wa-status?token=…   ← ChatHead posts status events here
 *   GET  /api/webhooks/chathead/wa-status/recent?token=…   last events received (for checking)
 *
 * Event shape (one JSON object per event; a body may also be a JSON array or one JSON object
 * per line):
 *   {"type":"status","status":"sent","message_id":"wamid.…"}
 *   {"type":"status","status":"delivered","message_id":"wamid.…"}
 *   {"type":"status","status":"read","message_id":"wamid.…"}
 *   {"type":"status","status":"failed","message_id":"wamid.…","reason":"…"}
 *
 * Each event updates the whatsapp_send_log row with that wamid (status + sent/delivered/read
 * time, or failed + error). A status never moves backwards: a late "delivered" after "read"
 * changes nothing, and repeats are harmless. Every event is also kept in a short Redis list so
 * we can see what ChatHead sends, including events with no matching row (a broadcast's wamid
 * is only filled in by the 15-min delivery sync; OTP sends are not logged at all).
 *
 * OFF until CHATHEAD_WEBHOOK_TOKEN is set: without it the endpoint answers 503 and does nothing.
 * Always answers 200 to a valid call, matched or not, so ChatHead never retries in a loop.
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import db from '../config/database.js';
import { getConnection } from '../services/queue/index.js';
import type { Request, Response } from 'express';

const router = express.Router();

const EVENTS_KEY = 'wa:status:events';
const EVENTS_KEEP = 1000;
// Only rows this recent are searched — keeps each update on the created_at index instead of
// scanning the whole log for a wamid.
const MATCH_DAYS = 14;

/** sent < delivered < read; failed only lands on a message that never got past sent. */
const RANK: Record<string, number> = { queued: 0, sent: 1, failed: 1, delivered: 2, read: 3 };

export interface WaStatusEvent { type?: string; status?: string; message_id?: string; reason?: string }
interface EventOutcome { message_id: string | null; status: string | null; result: 'updated' | 'unchanged' | 'unmatched' | 'invalid' }

function tokenOk(req: Request): boolean {
  const expected = process.env.CHATHEAD_WEBHOOK_TOKEN || '';
  const given = String(req.query.token ?? req.get('x-webhook-token') ?? '');
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Body → events. Accepts a JSON object, a JSON array, or text with one JSON object per line. */
export function parseEvents(body: unknown): WaStatusEvent[] | null {
  if (Array.isArray(body)) return body as WaStatusEvent[];
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return [body as WaStatusEvent];
  if (typeof body !== 'string' || !body.trim()) return null;
  const text = body.trim().replace(/^\uFEFF/, '');
  try {
    const j = JSON.parse(text) as unknown;
    return Array.isArray(j) ? (j as WaStatusEvent[]) : [j as WaStatusEvent];
  } catch { /* not one JSON value — try one per line */ }
  const out: WaStatusEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as WaStatusEvent); } catch { return null; }
  }
  return out;
}

async function applyEvent(evt: WaStatusEvent): Promise<EventOutcome> {
  const status = String(evt?.status || '').toLowerCase();
  const wamid = String(evt?.message_id || '').trim();
  if ((evt?.type && evt.type !== 'status') || !wamid || !(status in RANK) || status === 'queued') {
    return { message_id: wamid || null, status: status || null, result: 'invalid' };
  }
  const reason = evt.reason != null ? String(evt.reason).slice(0, 500) : null;

  // One statement: move the row forward only (never back), stamp the matching time once,
  // and record a failure reason. RETURNING tells matched-but-unchanged from unmatched.
  const { rows } = await db.query<{ id: number; moved: boolean }>(
    `WITH target AS (
       SELECT id, status FROM whatsapp_send_log
        WHERE wamid = $1 AND created_at > NOW() - ($4 || ' days')::interval
     )
     UPDATE whatsapp_send_log w SET
       status       = CASE WHEN $5::numeric > COALESCE(r.rank, 0) THEN $2 ELSE w.status END,
       sent_at      = CASE WHEN $2 IN ('sent','delivered','read') THEN COALESCE(w.sent_at, NOW()) ELSE w.sent_at END,
       delivered_at = CASE WHEN $2 IN ('delivered','read') THEN COALESCE(w.delivered_at, NOW()) ELSE w.delivered_at END,
       read_at      = CASE WHEN $2 = 'read' THEN COALESCE(w.read_at, NOW()) ELSE w.read_at END,
       error        = CASE WHEN $2 = 'failed' AND $5::numeric > COALESCE(r.rank, 0) THEN COALESCE($3, w.error) ELSE w.error END,
       delivery_reason = CASE WHEN $2 = 'failed' AND $3 IS NOT NULL AND $5::numeric > COALESCE(r.rank, 0) THEN $3 ELSE w.delivery_reason END
     FROM target t
     LEFT JOIN (VALUES ('queued',0::numeric),('sent',1),('failed',1),('delivered',2),('read',3)) AS r(st, rank) ON r.st = t.status
     WHERE w.id = t.id
     RETURNING w.id, ($5::numeric > COALESCE(r.rank, 0)) AS moved`,
    [wamid, status, reason, String(MATCH_DAYS), status === 'failed' ? RANK.failed + 0.5 : RANK[status]],
  );
  if (!rows.length) return { message_id: wamid, status, result: 'unmatched' };
  return { message_id: wamid, status, result: rows.some(r => r.moved) ? 'updated' : 'unchanged' };
}

async function remember(evt: WaStatusEvent, outcome: EventOutcome): Promise<void> {
  try {
    await getConnection().multi()
      .lpush(EVENTS_KEY, JSON.stringify({ at: new Date().toISOString(), event: evt, result: outcome.result }))
      .ltrim(EVENTS_KEY, 0, EVENTS_KEEP - 1)
      .exec();
  } catch { /* the list is only for checking — never fail the webhook over it */ }
}

router.post('/wa-status', async (req: Request, res: Response) => {
  if (!process.env.CHATHEAD_WEBHOOK_TOKEN) return res.status(503).json({ success: false, error: 'webhook not configured' });
  if (!tokenOk(req)) return res.status(401).json({ success: false, error: 'invalid token' });

  const events = parseEvents(req.body);
  if (!events) return res.status(400).json({ success: false, error: 'body must be a status event (JSON)' });

  const results: EventOutcome[] = [];
  for (const evt of events.slice(0, 500)) {
    let outcome: EventOutcome;
    try { outcome = await applyEvent(evt); }
    catch (err) {
      console.error('[WA webhook] update failed:', (err as Error).message);
      outcome = { message_id: evt?.message_id ?? null, status: evt?.status ?? null, result: 'unmatched' };
    }
    results.push(outcome);
    await remember(evt, outcome);
  }
  const count = (r: EventOutcome['result']) => results.filter(x => x.result === r).length;
  console.log(`[WA webhook] ${results.length} event(s): updated=${count('updated')} unchanged=${count('unchanged')} unmatched=${count('unmatched')} invalid=${count('invalid')}`);
  res.json({ success: true, received: results.length, results });
});

router.get('/wa-status/recent', async (req: Request, res: Response) => {
  if (!process.env.CHATHEAD_WEBHOOK_TOKEN) return res.status(503).json({ success: false, error: 'webhook not configured' });
  if (!tokenOk(req)) return res.status(401).json({ success: false, error: 'invalid token' });
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  try {
    const raw = await getConnection().lrange(EVENTS_KEY, 0, limit - 1);
    res.json({ success: true, data: raw.map(s => { try { return JSON.parse(s) as unknown; } catch { return s; } }) });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
