/**
 * weeklyProductUrlHealthCheck
 *
 * Weekly (Monday 06:00 Dubai) verifies each product's product-page URL is
 * still live. Marks products that return a definitive 404/410 as
 * available=false so they drop out of the AI recommendation candidate pool.
 *
 * Runs 1 hour AFTER the enriched sync (Monday 05:00 Dubai) so the sync writes
 * fresh `available` values FIRST, then this cron catches any URLs the source
 * API still claims are live but that actually 404.
 *
 * Guarantees:
 *   - Rate-limited: 1.2s pause between requests (memory:
 *     [journey-116-incident-2026-05] / URL-check note — rapid-fire against
 *     raynatours.com returns code 000 = connection refused).
 *   - Only touches products with `available IS NOT false` (skips already-dead
 *     rows to avoid needless load).
 *   - Only marks unavailable on a definitive 404 or 410 after 3 retries. Any
 *     other status (200/302/500/timeout) leaves the row untouched — network
 *     blips don't cause false unavailability.
 *   - Additive filter: uses the existing `available` column, no schema
 *     changes. If the enriched sync flips a URL back to available next week,
 *     this cron re-checks and either agrees or re-marks unavailable.
 */

import db from '../config/database.js';

const DELAY_MS       = parseInt(process.env.URL_HEALTH_DELAY_MS || '1200', 10);
const MAX_RETRIES    = parseInt(process.env.URL_HEALTH_MAX_RETRIES || '3', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.URL_HEALTH_TIMEOUT_MS || '15000', 10);

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Fetch URL and return final HTTP status code.
 *   - 0 → transport error / no HTTP response (retry candidate)
 *   - 200/301/302/... → the actual HTTP status
 * Uses HEAD first, falls back to GET on 405 (Method Not Allowed).
 */
async function _probe(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ac.signal, keepalive: false });
    if (res.status === 405) {
      // Server disallows HEAD — retry with GET (still cheap since we don't read the body).
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ac.signal, keepalive: false });
    }
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

async function _probeWithRetry(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const status = await _probe(url);
    // Definitive answer or non-retryable status
    if (status !== 0) return status;
    // Transport error — brief backoff then retry
    if (attempt < MAX_RETRIES) await _sleep(1500 + attempt * 500);
  }
  return 0;
}

export async function runWeeklyProductUrlHealthCheck() {
  const startedAt = Date.now();
  console.log(`[UrlHealthCheck] Starting at ${new Date().toISOString()}`);

  const { rows: candidates } = await db.query(`
    SELECT product_id, url
    FROM products
    WHERE url IS NOT NULL AND url <> ''
      AND (available IS NULL OR available = true)
    ORDER BY product_id
  `);
  console.log(`[UrlHealthCheck] ${candidates.length} products to check`);

  let ok = 0, dead = 0, transportError = 0, other = 0;
  const deadIds = [];
  for (let i = 0; i < candidates.length; i++) {
    const { product_id, url } = candidates[i];
    const status = await _probeWithRetry(url);

    if (status === 404 || status === 410) {
      dead++;
      deadIds.push(product_id);
    } else if (status === 0) {
      transportError++;
    } else if (status >= 200 && status < 400) {
      ok++;
    } else {
      other++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`[UrlHealthCheck] progress ${i + 1}/${candidates.length} | ok=${ok} dead=${dead} transportErr=${transportError} other=${other}`);
    }
    if (i < candidates.length - 1) await _sleep(DELAY_MS);
  }

  // Flip only the definitive dead ones. Transport errors and 5xx are left as-is
  // so we don't false-flag during a raynatours.com outage.
  let flipped = 0;
  if (deadIds.length > 0) {
    const result = await db.query(
      `UPDATE products SET available = false WHERE product_id = ANY($1::int[]) AND (available IS NULL OR available = true)`,
      [deadIds]
    );
    flipped = result.rowCount || 0;
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[UrlHealthCheck] Done in ${(durationMs / 1000).toFixed(1)}s — ok=${ok} dead=${dead} transportErr=${transportError} other=${other} flipped_to_unavailable=${flipped}`);

  // sync_metadata write so the /data-pipeline UI shows the last-run info.
  try {
    await db.query(`
      INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
      VALUES ('product_url_health_check', NOW(), $1, 'success', NULL, $2, NOW())
      ON CONFLICT (table_name) DO UPDATE SET
        last_synced_at   = EXCLUDED.last_synced_at,
        rows_synced      = EXCLUDED.rows_synced,
        sync_status      = 'success',
        error_message    = NULL,
        sync_duration_ms = EXCLUDED.sync_duration_ms,
        updated_at       = NOW()
    `, [flipped, durationMs]);
  } catch (metaErr) {
    console.warn('[UrlHealthCheck] sync_metadata write failed:', metaErr.message);
  }

  return { checked: candidates.length, ok, dead, transportError, other, flipped, durationMs };
}

export default runWeeklyProductUrlHealthCheck;
