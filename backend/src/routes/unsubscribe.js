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
// Project logo — the frontend serves it publicly at this URL (reachable from any browser,
// local or prod). Pinned to the public domain (not TRACKING_BASE_URL, which may be localhost).
const LOGO_URL = process.env.UNSUB_LOGO_URL || 'https://promotions.raynatours.com/rayna-logo.webp';

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
  let uid = null, email = null, journeyId = null, nodeId = null, logId = null;
  if (t) { uid = verifyUnsubToken(t); }
  if (!uid && log && /^\d+$/.test(String(log))) {
    logId = parseInt(log);
    const { rows: [r] } = await db.query(
      'SELECT unified_id, email, journey_id, node_id FROM email_send_log WHERE id = $1', [logId]
    );
    if (r) { uid = r.unified_id; email = r.email; journeyId = r.journey_id; nodeId = r.node_id; }
  }
  if (!uid) return null;
  const { rows: [c] } = await db.query('SELECT id, email, email_unsubscribe FROM unified_contacts WHERE id = $1', [uid]);
  if (!c) return null;
  return {
    uid: c.id, email: c.email || email,
    unsubscribed: String(c.email_unsubscribe || '').toLowerCase() === 'yes',
    journeyId, nodeId, logId,
  };
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
  .logo{height:56px;width:auto;display:block;margin:0 auto 10px}
  h1{font-size:20px;margin:24px 0 8px}
  p{font-size:14px;color:#5f6368;line-height:1.6;margin:8px 0}
  .email{font-weight:600;color:#1a1a1a}
  .btn{display:inline-block;border:none;border-radius:10px;padding:12px 22px;font-size:14px;font-weight:600;cursor:pointer;margin:6px}
  .btn-danger{background:#e92d2a;color:#fff}
  .btn-ghost{background:#fff;color:#5f6368;border:1px solid #d6d8dc}
  .btn-primary{background:#0ea5e9;color:#fff}
  .input{width:100%;padding:12px 14px;border:1px solid #d6d8dc;border-radius:10px;font-size:14px;margin:10px 0 4px;outline:none}
  .input:focus{border-color:#0ea5e9}
  details{margin:14px 0 4px;text-align:left}
  summary{cursor:pointer;font-weight:600;color:#0ea5e9;font-size:14px;list-style:none;text-align:center;padding:6px 0}
  summary::-webkit-details-marker{display:none}
  .ok{color:#16a34a;font-weight:700;font-size:34px}
  .sails{display:inline-block;height:30px;margin-bottom:6px}
  a{color:#0ea5e9;text-decoration:none}
</style></head><body><div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Rayna Tours" />
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
      <h1>Manage email preferences</h1>
      <p>For <span class="email">${escapeHtml(c.email)}</span>, choose an option below.</p>

      <form method="POST" action="/api/unsubscribe/confirm?${ref}" style="margin-top:18px">
        <button type="submit" class="btn btn-danger">Unsubscribe from emails</button>
      </form>

      <details>
        <summary>Change email address instead</summary>
        <p style="text-align:left;margin:8px 0 0">Prefer to keep getting our offers at a different address? Update it here — you'll stay subscribed.</p>
        <form method="POST" action="/api/unsubscribe/change-email?${ref}">
          <input class="input" type="email" name="email" required placeholder="your new email address" autocomplete="email" />
          <button type="submit" class="btn btn-primary" style="width:100%;margin:6px 0 0">Update email address</button>
        </form>
      </details>

      <div style="margin-top:16px"><a href="https://www.raynatours.com" class="btn btn-ghost" style="text-decoration:none">Keep me subscribed</a></div>`));
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
        // Record WHICH journey + node the email came from (resolved from the send-log id),
        // so unsubscribes are attributable per journey/node.
        await db.query(
          `INSERT INTO unsubscribe_log (unified_id, email, journey_id, node_id, campaign, source_log_id)
           VALUES ($1, $2, $3, $4, 'unsubscribe_page', $5) ON CONFLICT DO NOTHING`,
          [c.uid, c.email, c.journeyId, c.nodeId, c.logId]
        ).catch(() => {});
      }
      console.log(`[Unsubscribe] uid=${c.uid} email=${c.email} opted out via confirmation page (journey=${c.journeyId} node=${c.nodeId})`);
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

// POST /unsubscribe/change-email — update the contact's email in place (same user ID),
// keeping them subscribed. The link identifies the contact (uid from ?log= / ?t=), so the
// change is scoped to that account. Requires the POST (human form submit), so link
// pre-fetch by scanners can't trigger it. express.urlencoded parses the form body.
router.post('/change-email', express.urlencoded({ extended: false }), async (req, res) => {
  const ref = req.query.t ? `t=${encodeURIComponent(req.query.t)}` : `log=${encodeURIComponent(req.query.log)}`;
  try {
    const c = await resolveContact({ log: req.query.log, t: req.query.t });
    if (!c) return res.status(400).send(shell(`<h1>Link not valid</h1><p>This link is invalid or has expired.</p>`));

    const newEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).send(shell(`<h1>Invalid email</h1><p>Please enter a valid email address.</p><p style="margin-top:14px"><a href="/api/unsubscribe?${ref}">← Go back</a></p>`));
    }
    if (newEmail === String(c.email || '').trim().toLowerCase()) {
      return res.send(shell(`<h1>No change needed</h1><p><span class="email">${escapeHtml(newEmail)}</span> is already the email on file.</p><p style="margin-top:14px"><a href="/api/unsubscribe?${ref}">← Go back</a></p>`));
    }

    // Guard against silently overwriting a DIFFERENT contact's email (would create a duplicate).
    const { rows: [dup] } = await db.query(
      'SELECT id FROM unified_contacts WHERE LOWER(TRIM(email)) = $1 AND id <> $2 LIMIT 1', [newEmail, c.uid]
    );
    if (dup) {
      return res.status(409).send(shell(`<h1>Email already in use</h1><p><span class="email">${escapeHtml(newEmail)}</span> is already linked to another account. Please contact <a href="mailto:info@raynatours.com">info@raynatours.com</a>.</p>`));
    }

    // Update the current email (both columns) AND append to the email-change audit trail
    // atomically. email_send_log rows are left untouched — their per-send email is an
    // immutable snapshot, so historical sends keep showing the address they went to.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        'UPDATE unified_contacts SET email = $1, actual_email = $1, updated_at = NOW() WHERE id = $2',
        [newEmail, c.uid]
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).send(shell(`<h1>Something went wrong</h1><p>We couldn't update your email. Please try again later.</p>`));
      }
      await client.query(
        `INSERT INTO contact_email_history (unified_id, old_email, new_email, source)
         VALUES ($1, $2, $3, 'unsubscribe_page')`,
        [c.uid, c.email, newEmail]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`[Unsubscribe] uid=${c.uid} changed email ${c.email} -> ${newEmail}`);
    return res.send(shell(`
      <div class="ok">✓</div>
      <h1>Email updated</h1>
      <p>Your email has been changed to <span class="email">${escapeHtml(newEmail)}</span>. You'll keep receiving Rayna Tours emails at your new address.</p>
      <p style="margin-top:18px"><a href="https://www.raynatours.com">Back to Rayna Tours</a></p>`));
  } catch (e) {
    console.error('[Unsubscribe change-email] error:', e.message);
    res.status(500).send(shell(`<h1>Something went wrong</h1><p>We couldn't process your request. Please try again later.</p>`));
  }
});

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

export default router;
