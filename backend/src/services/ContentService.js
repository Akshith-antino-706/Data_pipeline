import { query } from '../config/database.js';

export class ContentService {

  /** Get all templates with pagination & filters */
  static async getAll({ channel, status, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (channel) { conditions.push(`channel = $${idx++}`); params.push(channel); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    // Truncate `body` to 2 KB in the list response. The list view only renders
    // a stripHtml() snippet — full body (25 KB+ each) is fetched via getById()
    // when the editor opens. Large responses (~500 KB for 20 rows) were
    // triggering `ERR_CONTENT_LENGTH_MISMATCH` through the production CDN.
    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM content_templates ${where}`, params),
      query(
        `SELECT id, name, channel, status, subject, LEFT(body, 2000) AS body, body_plain,
                media_url, cta_url, cta_text, wa_template_name, wa_namespace, variables,
                ai_generated, ai_prompt, ai_model, version, parent_id,
                approved_by, approved_at, created_at, updated_at, created_by,
                html_template_id, segment_label,
                external_provider, external_template_id, external_status,
                external_category, external_language,
                external_submitted_at, external_approved_at,
                external_rejected_at, external_rejection_reason,
                external_last_checked_at, external_payload
           FROM content_templates ${where}
          ORDER BY updated_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].total),
      page,
      limit,
    };
  }

  /** Get template by ID.
   *  For templates linked to email_html_templates (via html_template_id),
   *  the source HTML lives in email_html_templates.html_body — return that as
   *  `body` so the editor loads the SOURCE template, not whatever stub is
   *  stored in content_templates.body. */
  static async getById(id) {
    const { rows } = await query(`
      SELECT ct.*,
             COALESCE(NULLIF(eht.html_body, ''), ct.body) AS body,
             eht.html_body AS html_body,
             eht.engine    AS html_engine
      FROM content_templates ct
      LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = $1
    `, [id]);
    return rows[0] || null;
  }

  /** Create a new template */
  static async create({ name, channel, subject, body, bodyPlain, mediaUrl, ctaUrl, ctaText, variables, aiGenerated, aiPrompt, aiModel, createdBy }) {
    const { rows } = await query(`
      INSERT INTO content_templates
        (name, channel, subject, body, body_plain, media_url, cta_url, cta_text, variables, ai_generated, ai_prompt, ai_model, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [name, channel, subject, body, bodyPlain, mediaUrl, ctaUrl, ctaText, variables || [], aiGenerated || false, aiPrompt, aiModel, createdBy]);
    return rows[0];
  }

  /** Update a template.
   *  If the row is linked to an email_html_templates entry (html_template_id),
   *  HTML body edits go to email_html_templates.html_body (the renderer's
   *  source of truth). Subject + name + status still update content_templates. */
  static async update(id, fields) {
    const allowedFields = ['name', 'subject', 'body', 'body_plain', 'media_url', 'cta_url', 'cta_text', 'variables', 'status'];
    const sets = [];
    const params = [];
    let i = 1;

    for (const [key, val] of Object.entries(fields)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbKey) && val !== undefined) {
        sets.push(`${dbKey} = $${i++}`);
        params.push(val);
      }
    }
    if (sets.length === 0) return null;

    params.push(id);
    const { rows } = await query(
      `UPDATE content_templates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    const row = rows[0];
    if (!row) return null;

    // If this content_template is linked to an email_html_templates row, the
    // renderer reads HTML from there — keep both in sync so the editor's HTML
    // changes actually take effect on send + preview.
    if (row.html_template_id && fields.body !== undefined) {
      await query(
        `UPDATE email_html_templates
            SET html_body  = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [fields.body, row.html_template_id]
      );
    }

    // Same for subject — store on email_html_templates.subject_line so future
    // sends pick up the change (subject also lives on content_templates).
    if (row.html_template_id && fields.subject !== undefined) {
      await query(
        `UPDATE email_html_templates
            SET subject_line = $1,
                updated_at   = NOW()
          WHERE id = $2`,
        [fields.subject, row.html_template_id]
      );
    }

    return row;
  }

  /** Approve a template */
  static async approve(id, approvedBy) {
    const { rows } = await query(`
      UPDATE content_templates
      SET status = 'approved', approved_by = $2, approved_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, approvedBy]);
    return rows[0];
  }

  /** Reject a template */
  static async reject(id) {
    const { rows } = await query(`
      UPDATE content_templates SET status = 'rejected' WHERE id = $1 RETURNING *
    `, [id]);
    return rows[0];
  }

  /** Render template with variables replaced */
  static renderTemplate(template, customerData) {
    let body = template.body;
    let subject = template.subject || '';

    const vars = {
      first_name: customerData.full_name?.split(' ')[0] || 'there',
      full_name: customerData.full_name || 'Valued Customer',
      email: customerData.email || '',
      country: customerData.country || '',
      nationality: customerData.nationality || '',
      segment: customerData.segment_label || '',
      bookings: String(customerData.total_bookings || 0),
    };

    for (const [key, val] of Object.entries(vars)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      body = body.replace(pattern, val);
      subject = subject.replace(pattern, val);
    }

    return { body, subject };
  }

  /** Delete a template by ID */
  static async delete(id) {
    const { rows } = await query('DELETE FROM content_templates WHERE id = $1 RETURNING id', [id]);
    return rows[0] || null;
  }
}
