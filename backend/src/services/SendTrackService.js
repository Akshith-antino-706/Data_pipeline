import db from '../config/database.js';

// ── Buffered batch insert (opt-in via JOURNEY_LOG_BATCH=true) ──
// High-volume journey sends do one INSERT per email (+ index writes per row).
// To cut that load, the worker can: reserveLogId() — an id from a pre-fetched
// sequence block (no per-row DB round-trip) — then bufferLog() the FINAL row and
// let a timer batch-insert up to _FLUSH_MAX rows in ONE statement. Opens/clicks
// (UPDATE by id) arrive minutes later, long after the ~1s flush, so the row
// exists by then. Trade-off: rows buffered when the process is hard-killed are
// lost (the email already sent) — bounded to <_FLUSH_MS of rows.
const _ID_BLOCK  = parseInt(process.env.JOURNEY_LOG_ID_BLOCK  || '1000');
const _FLUSH_MAX = parseInt(process.env.JOURNEY_LOG_FLUSH_MAX || '500');
const _FLUSH_MS  = parseInt(process.env.JOURNEY_LOG_FLUSH_MS  || '1000');
let _idPool = [];
const _logBuffer = [];
let _flushTimer = null;

/**
 * Tracks email sends from test-send routes.
 *
 * Lifecycle: logSend() → markSent()/markFailed() → markOpened() → markClicked()
 */
export class SendTrackService {

  /**
   * Reserve a pre-allocated id (no INSERT). Ids come from sequence blocks so the
   * worker can build tracking URLs before sending without a per-row DB round-trip.
   */
  static async reserveLogId() {
    if (_idPool.length === 0) {
      const { rows } = await db.query(
        `SELECT nextval('email_send_log_id_seq')::bigint AS id FROM generate_series(1, $1)`,
        [_ID_BLOCK]
      );
      _idPool = rows.map(r => Number(r.id));
    }
    return _idPool.shift();
  }

  /**
   * Queue a fully-formed send-log row for batched insert. Flushes when the buffer
   * hits _FLUSH_MAX or after _FLUSH_MS, whichever comes first.
   */
  static bufferLog(rec) {
    _logBuffer.push(rec);
    if (_logBuffer.length >= _FLUSH_MAX) {
      SendTrackService.flushLogs().catch(err => console.error('[SendTrack] flush error:', err.message));
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(() => {
        _flushTimer = null;
        SendTrackService.flushLogs().catch(err => console.error('[SendTrack] flush error:', err.message));
      }, _FLUSH_MS);
    }
  }

  /**
   * Insert all buffered rows in a single multi-row INSERT. Safe to call anytime
   * (e.g. on graceful shutdown).
   */
  static async flushLogs() {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (_logBuffer.length === 0) return;
    const batch = _logBuffer.splice(0, _logBuffer.length);
    const cols = ['id','unified_id','email','contact_name','subject','template_label',
                  'day_number','source','journey_id','node_id','status','external_id',
                  'provider','duration_ms','error_message','sent_at'];
    const tuples = [];
    const params = [];
    let p = 1;
    for (const r of batch) {
      tuples.push(`(${cols.map((_, i) => `$${p + i}`).join(',')})`);
      params.push(
        r.id, r.unifiedId ?? null, r.email, r.contactName ?? null, r.subject ?? null,
        r.templateLabel ?? null, r.dayNumber ?? null, r.source || 'journey',
        r.journeyId ?? null, r.nodeId ?? null, r.status || 'sent', r.externalId ?? null,
        r.provider ?? null, r.durationMs ?? null, r.error ?? null, r.sentAt || new Date()
      );
      p += cols.length;
    }
    try {
      await db.query(
        `INSERT INTO email_send_log (${cols.join(',')}) VALUES ${tuples.join(',')}
         ON CONFLICT (id) DO NOTHING`,
        params
      );
    } catch (err) {
      console.error(`[SendTrack] batch insert of ${batch.length} rows failed: ${err.message}`);
    }
  }

  /**
   * Reserve a log row before sending (returns id for pixel injection).
   */
  static async logSend({ unifiedId, email, contactName, subject, templateLabel, dayNumber, source = 'test-send', journeyId = null, nodeId = null }) {
    const { rows } = await db.query(`
      INSERT INTO email_send_log
        (unified_id, email, contact_name, subject, template_label, day_number, source, journey_id, node_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')
      RETURNING id
    `, [unifiedId || null, email, contactName || null, subject, templateLabel, dayNumber || null, source, journeyId || null, nodeId || null]);
    return rows[0].id;
  }

  static async markSent(id, { externalId, provider, durationMs }) {
    await db.query(`
      UPDATE email_send_log
      SET status = 'sent', external_id = $2, provider = $3, duration_ms = $4, sent_at = NOW()
      WHERE id = $1
    `, [id, externalId || null, provider || null, durationMs || null]);
  }

  static async markFailed(id, { error, provider, durationMs }) {
    await db.query(`
      UPDATE email_send_log
      SET status = 'failed', error_message = $2, provider = $3, duration_ms = $4, sent_at = NOW()
      WHERE id = $1
    `, [id, error || null, provider || null, durationMs || null]);
  }

  /**
   * Called by the open-tracking pixel endpoint.
   */
  // meta = { ua, ip } from the tracking request — stored for bot filtering (Phase 2).
  // COALESCE keeps the FIRST event's UA/IP (matches the opened_at/clicked_at semantics).
  static async markOpened(id, meta = {}) {
    await db.query(`
      UPDATE email_send_log
      SET status = CASE WHEN status NOT IN ('clicked') THEN 'opened' ELSE status END,
          opened_at = COALESCE(opened_at, NOW()),
          open_ua = COALESCE(open_ua, $2),
          open_ip = COALESCE(open_ip, $3)
      WHERE id = $1
    `, [id, meta.ua || null, meta.ip || null]);
  }

  /**
   * Called by the click-tracking redirect endpoint.
   */
  static async markClicked(id, meta = {}) {
    await db.query(`
      UPDATE email_send_log
      SET status = 'clicked',
          opened_at  = COALESCE(opened_at, NOW()),
          clicked_at = COALESCE(clicked_at, NOW()),
          click_ua = COALESCE(click_ua, $2),
          click_ip = COALESCE(click_ip, $3)
      WHERE id = $1
    `, [id, meta.ua || null, meta.ip || null]);
  }

  /**
   * Paginated list of all sends with optional filters.
   *
   * @param {object} opts
   * @param {number}  [opts.page=1]
   * @param {number}  [opts.limit=50]
   * @param {string}  [opts.status]      - queued|sent|failed|opened|clicked
   * @param {string}  [opts.email]       - partial match
   * @param {number}  [opts.dayNumber]   - 1-7
   * @param {string}  [opts.source]      - test-send|campaign|journey
   * @param {string}  [opts.dateFrom]    - ISO date
   * @param {string}  [opts.dateTo]      - ISO date
   */
  static async getLog({ page = 1, limit = 50, status, email, dayNumber, source, dateFrom, dateTo, subscriptionStatus, journeyId, nodeId } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status === 'opened')  { conditions.push(`esl.opened_at IS NOT NULL`); }
    else if (status === 'clicked') { conditions.push(`esl.clicked_at IS NOT NULL`); }
    else if (status) { conditions.push(`esl.status = $${idx++}`);              params.push(status); }
    if (email)      { conditions.push(`esl.email ILIKE $${idx++}`);             params.push(`%${email}%`); }
    if (dayNumber)  { conditions.push(`esl.day_number = $${idx++}`);            params.push(Number(dayNumber)); }
    if (source)     { conditions.push(`esl.source = $${idx++}`);                params.push(source); }
    if (dateFrom)   { conditions.push(`esl.created_at >= $${idx++}`);           params.push(dateFrom); }
    if (dateTo)     { conditions.push(`esl.created_at <= $${idx++}`);           params.push(dateTo); }
    if (journeyId)  { conditions.push(`esl.journey_id = $${idx++}`);            params.push(Number(journeyId)); }
    if (nodeId)     { conditions.push(`esl.node_id = $${idx++}`);               params.push(nodeId); }
    if (subscriptionStatus === 'unsubscribed') {
      conditions.push(`uc.email_unsubscribe = 'Yes'`);
    } else if (subscriptionStatus === 'active') {
      conditions.push(`(uc.email_unsubscribe IS NULL OR uc.email_unsubscribe != 'Yes')`);
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(`
        SELECT
          esl.id, esl.unified_id, esl.email, esl.contact_name,
          esl.subject, esl.template_label, esl.day_number, esl.source,
          esl.journey_id, esl.node_id,
          esl.external_id, esl.provider, esl.status, esl.error_message,
          esl.sent_at, esl.opened_at, esl.clicked_at, esl.duration_ms, esl.created_at,
          uc.name AS uc_name,
          uc.email_unsubscribe AS email_unsubscribed
        FROM email_send_log esl
        LEFT JOIN unified_contacts uc ON uc.id = esl.unified_id
        ${where}
        ORDER BY esl.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, limit, offset]),

      db.query(`
        SELECT COUNT(*) AS total
        FROM email_send_log esl
        LEFT JOIN unified_contacts uc ON uc.id = esl.unified_id
        ${where}
      `, params),
    ]);

    return { rows, total: parseInt(countRows[0].total), page, limit };
  }

  /**
   * All sends to a single contact (most recent first).
   */
  static async getByUnifiedId(unifiedId, { limit = 30 } = {}) {
    const { rows } = await db.query(`
      SELECT id, email, subject, template_label, day_number, source,
             status, external_id, error_message,
             sent_at, opened_at, clicked_at, duration_ms, created_at
      FROM email_send_log
      WHERE unified_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [unifiedId, limit]);
    return rows;
  }

  /**
   * Aggregate summary: counts by status and per-day breakdown.
   * Window defaults to 30 days — full-table GROUP BY on email_send_log times
   * out at the gateway in production.
   */
  static async getSummary({ days = 30 } = {}) {
    const windowDays = Math.min(365, Math.max(1, parseInt(days) || 30));
    const [{ rows: byStatus }, { rows: byDay }] = await Promise.all([
      db.query(`
        SELECT status, COUNT(*) AS count, COUNT(DISTINCT email) AS unique_recipients
        FROM email_send_log
        WHERE created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY status
        ORDER BY count DESC
      `, [String(windowDays)]),
      db.query(`
        SELECT
          day_number,
          template_label,
          COUNT(*)                                         AS total_sent,
          COUNT(*) FILTER (WHERE status = 'opened')        AS opened,
          COUNT(*) FILTER (WHERE status = 'clicked')       AS clicked,
          COUNT(*) FILTER (WHERE status = 'failed')        AS failed,
          ROUND(
            COUNT(*) FILTER (WHERE status IN ('opened','clicked')) * 100.0
            / NULLIF(COUNT(*) FILTER (WHERE status <> 'failed'), 0), 1
          )                                                AS open_rate_pct
        FROM email_send_log
        WHERE day_number IS NOT NULL
          AND created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY day_number, template_label
        ORDER BY day_number
      `, [String(windowDays)]),
    ]);
    return { byStatus, byDay, windowDays };
  }

  /**
   * Save a UTM visit captured at the click-tracking redirect.
   */
  static async logUtmVisit({ logId, unifiedId, email, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, rid, destinationUrl }) {
    await db.query(`
      INSERT INTO utm_visits
        (log_id, unified_id, email, utm_source, utm_medium, utm_campaign, utm_content, utm_term, rid, destination_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [logId || null, unifiedId || null, email || null, utmSource || null, utmMedium || null,
        utmCampaign || null, utmContent || null, utmTerm || null, rid || null, destinationUrl || null]);
  }

  /**
   * Paginated UTM visit log with optional filters.
   */
  static async getUtmLog({ page = 1, limit = 50, utmSource, utmMedium, utmCampaign, utmContent, email, dateFrom, dateTo } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (utmSource)   { conditions.push(`uv.utm_source = $${idx++}`);              params.push(utmSource); }
    if (utmMedium)   { conditions.push(`uv.utm_medium = $${idx++}`);              params.push(utmMedium); }
    if (utmCampaign) { conditions.push(`uv.utm_campaign ILIKE $${idx++}`);        params.push(`%${utmCampaign}%`); }
    if (utmContent)  { conditions.push(`uv.utm_content ILIKE $${idx++}`);         params.push(`%${utmContent}%`); }
    if (email)       { conditions.push(`uv.email ILIKE $${idx++}`);               params.push(`%${email}%`); }
    if (dateFrom)    { conditions.push(`uv.created_at >= $${idx++}`);             params.push(dateFrom); }
    if (dateTo)      { conditions.push(`uv.created_at <= $${idx++}`);             params.push(dateTo); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      db.query(`
        SELECT
          uv.id, uv.log_id, uv.unified_id, uv.email,
          uv.utm_source, uv.utm_medium, uv.utm_campaign, uv.utm_content, uv.utm_term,
          uv.rid, uv.destination_url, uv.created_at,
          uc.name AS contact_name
        FROM utm_visits uv
        LEFT JOIN unified_contacts uc ON uc.id = uv.unified_id
        ${where}
        ORDER BY uv.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, limit, offset]),

      db.query(`SELECT COUNT(*) AS total FROM utm_visits uv ${where}`, params),
    ]);

    return { rows, total: parseInt(countRows[0].total), page, limit };
  }

  /**
   * UTM summary: clicks grouped by campaign, source, medium.
   */
  static async getUtmSummary() {
    const [{ rows: byCampaign }, { rows: bySource }] = await Promise.all([
      db.query(`
        SELECT
          utm_campaign,
          utm_source,
          utm_medium,
          COUNT(*)                        AS total_clicks,
          COUNT(DISTINCT unified_id)      AS unique_visitors,
          COUNT(DISTINCT email)           AS unique_emails
        FROM utm_visits
        WHERE utm_campaign IS NOT NULL
        GROUP BY utm_campaign, utm_source, utm_medium
        ORDER BY total_clicks DESC
      `),
      db.query(`
        SELECT
          utm_source,
          COUNT(*)                   AS total_clicks,
          COUNT(DISTINCT email)      AS unique_emails
        FROM utm_visits
        GROUP BY utm_source
        ORDER BY total_clicks DESC
      `),
    ]);
    return { byCampaign, bySource };
  }
}
