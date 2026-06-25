/**
 * Public unsubscribe flow — hosted on promotions.raynatours.com.
 *
 *   GET  /unsubscribe?log=<sendLogId>     → branded CONFIRMATION page (does NOT opt out)
 *   POST /unsubscribe/confirm?log=<id>    → performs the opt-out + success page
 *
 * Why a confirmation step: Gmail/Outlook/security scanners PRE-FETCH links. A plain
 * GET that opts out would falsely unsubscribe real recipients. So the GET only shows a
 * page; the actual opt-out requires the POST (a human clicking "Confirm").
 *
 * Identity: the email's unsubscribe link is click-tracked, so it already carries the
 * email_send_log id → which maps to the contact. We also accept a signed token (?t=).
 */
import express from 'express';
import crypto from 'node:crypto';
import db from '../config/database.js';

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'rayna-unsub-secret';

// Signed token (uid) — optional alternative to ?log=
export function signUnsubToken(uid) {
  const payload = Buffer.from(String(uid)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(String(uid)).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyUnsubToken(token) {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  let uid; try { uid = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  const expected = crypto.createHmac('sha256', SECRET).update(uid).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? uid : null;
}

// Resolve the contact from ?log= (send-log id) or ?t= (signed token). → { uid, email } | null
async function resolveContact({ log, t }) {
  let uid = null, email = null;
  if (t) { uid = verifyUnsubToken(t); }
  if (!uid && log && /^\d+$/.test(String(log))) {
    const { rows: [r] } = await db.query('SELECT unified_id, email FROM email_send_log WHERE id = $1', [parseInt(log)]);
    if (r) { uid = r.unified_id; email = r.email; }
  }
  if (!uid) return null;
  const { rows: [c] } = await db.query('SELECT id, email, email_unsubscribe FROM unified_contacts WHERE id = $1', [uid]);
  if (!c) return null;
  return { uid: c.id, email: c.email || email, unsubscribed: String(c.email_unsubscribe || '').toLowerCase() === 'yes' };
}

// ── Branded page shell (Rayna styling) ──────────────────────────────────────
function shell(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Rayna Tours — Email Preferences</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #e7e8ec;border-radius:16px;max-width:480px;width:100%;padding:40px 36px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  .brand{font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:26px;letter-spacing:.5px;color:#1a1a1a;margin-bottom:4px}
  .brand small{display:block;font-family:inherit;font-size:10px;letter-spacing:2px;color:#9aa0a6;font-weight:400;margin-top:2px}
  h1{font-size:20px;margin:24px 0 8px}
  p{font-size:14px;color:#5f6368;line-height:1.6;margin:8px 0}
  .email{font-weight:600;color:#1a1a1a}
  .btn{display:inline-block;border:none;border-radius:10px;padding:12px 22px;font-size:14px;font-weight:600;cursor:pointer;margin:6px}
  .btn-danger{background:#e92d2a;color:#fff}
  .btn-ghost{background:#fff;color:#5f6368;border:1px solid #d6d8dc}
  .ok{color:#16a34a;font-weight:700;font-size:34px}
  .sails{display:inline-block;height:30px;margin-bottom:6px}
  a{color:#0ea5e9;text-decoration:none}
</style></head><body><div class="card">
  <div class="brand">RAYNA<small>TOURS</small></div>
  ${inner}
</div></body></html>`;
}

// GET /unsubscribe — confirmation page (no opt-out yet)
router.get('/', async (req, res) => {
  try {
    const c = await resolveContact({ log: req.query.log, t: req.query.t });
    if (!c) return res.status(400).send(shell(`<h1>Link not valid</h1><p>This unsubscribe link is invalid or has expired. If you keep receiving emails you don't want, contact <a href="mailto:info@raynatours.com">info@raynatours.com</a>.</p>`));
    if (c.unsubscribed) return res.send(shell(`<h1>You're already unsubscribed</h1><p><span class="email">${escapeHtml(c.email)}</span> is no longer subscribed to Rayna Tours marketing emails.</p>`));
    const ref = req.query.t ? `t=${encodeURIComponent(req.query.t)}` : `log=${encodeURIComponent(req.query.log)}`;
    return res.send(shell(`
      <h1>Unsubscribe from emails?</h1>
      <p>You're about to unsubscribe <span class="email">${escapeHtml(c.email)}</span> from Rayna Tours marketing emails. You won't receive offers, holiday picks, or visa updates from us.</p>
      <form method="POST" action="/api/unsubscribe/confirm?${ref}" style="margin-top:18px">
        <button type="submit" class="btn btn-danger">Confirm unsubscribe</button>
        <a href="https://www.raynatours.com" class="btn btn-ghost" style="text-decoration:none">Keep me subscribed</a>
      </form>`));
  } catch (e) {
    console.error('[Unsubscribe GET] error:', e.message);
    res.status(500).send(shell(`<h1>Something went wrong</h1><p>Please try again later.</p>`));
  }
});

// POST /unsubscribe/confirm — perform the opt-out
router.post('/confirm', async (req, res) => {
  try {
    const c = await resolveContact({ log: req.query.log, t: req.query.t });
    if (!c) return res.status(400).send(shell(`<h1>Link not valid</h1><p>This unsubscribe link is invalid or has expired.</p>`));
    if (!c.unsubscribed) {
      // COALESCE so NULL (default) contacts are opted out too — not just explicit 'No'.
      const { rowCount } = await db.query(
        `UPDATE unified_contacts SET email_unsubscribe = 'Yes', updated_at = NOW()
         WHERE id = $1 AND COALESCE(email_unsubscribe, 'No') <> 'Yes'`, [c.uid]
      );
      if (rowCount > 0) {
        await db.query(
          `INSERT INTO unsubscribe_log (unified_id, email, journey_id, node_id, campaign, source_log_id)
           VALUES ($1, $2, NULL, NULL, 'unsubscribe_page', $3) ON CONFLICT DO NOTHING`,
          [c.uid, c.email, /^\d+$/.test(String(req.query.log)) ? parseInt(req.query.log) : null]
        ).catch(() => {});
      }
      console.log(`[Unsubscribe] uid=${c.uid} email=${c.email} opted out via confirmation page`);
    }
    return res.send(shell(`
      <div class="ok">✓</div>
      <h1>You've been unsubscribed</h1>
      <p><span class="email">${escapeHtml(c.email)}</span> will no longer receive Rayna Tours marketing emails. We're sorry to see you go.</p>
      <p style="margin-top:18px"><a href="https://www.raynatours.com">Back to Rayna Tours</a></p>`));
  } catch (e) {
    console.error('[Unsubscribe POST] error:', e.message);
    res.status(500).send(shell(`<h1>Something went wrong</h1><p>We couldn't process your request. Please try again later.</p>`));
  }
});

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

export default router;
