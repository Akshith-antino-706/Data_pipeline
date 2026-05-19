import db from '../config/database.js';

/**
 * Tracks email sends from test-send routes.
 *
 * Lifecycle: logSend() → markSent()/markFailed() → markOpened() → markClicked()
 */
export class SendTrackService {

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
  static async markOpened(id) {
    await db.query(`
      UPDATE email_send_log
      SET status = CASE WHEN status NOT IN ('clicked') THEN 'opened' ELSE status END,
          opened_at = COALESCE(opened_at, NOW())
      WHERE id = $1
    `, [id]);
  }

  /**
   * Called by the click-tracking redirect endpoint.
   */
  static async markClicked(id) {
    await db.query(`
      UPDATE email_send_log
      SET status = 'clicked',
          opened_at  = COALESCE(opened_at, NOW()),
          clicked_at = COALESCE(clicked_at, NOW())
      WHERE id = $1
    `, [id]);
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
  static async getLog({ page = 1, limit = 50, status, email, dayNumber, source, dateFrom, dateTo } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status)     { conditions.push(`esl.status = $${idx++}`);               params.push(status); }
    if (email)      { conditions.push(`esl.email ILIKE $${idx++}`);             params.push(`%${email}%`); }
    if (dayNumber)  { conditions.push(`esl.day_number = $${idx++}`);            params.push(Number(dayNumber)); }
    if (source)     { conditions.push(`esl.source = $${idx++}`);                params.push(source); }
    if (dateFrom)   { conditions.push(`esl.created_at >= $${idx++}`);           params.push(dateFrom); }
    if (dateTo)     { conditions.push(`esl.created_at <= $${idx++}`);           params.push(dateTo); }

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
          uc.name   AS uc_name
        FROM email_send_log esl
        LEFT JOIN unified_contacts uc ON uc.id = esl.unified_id
        ${where}
        ORDER BY esl.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, limit, offset]),

      db.query(`SELECT COUNT(*) AS total FROM email_send_log esl ${where}`, params),
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
   */
  static async getSummary() {
    const [{ rows: byStatus }, { rows: byDay }] = await Promise.all([
      db.query(`
        SELECT status, COUNT(*) AS count, COUNT(DISTINCT email) AS unique_recipients
        FROM email_send_log
        GROUP BY status
        ORDER BY count DESC
      `),
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
        GROUP BY day_number, template_label
        ORDER BY day_number
      `),
    ]);
    return { byStatus, byDay };
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
