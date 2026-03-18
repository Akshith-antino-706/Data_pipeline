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

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM content_templates ${where}`, params),
      query(
        `SELECT * FROM content_templates ${where} ORDER BY updated_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
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

  /** Get template by ID */
  static async getById(id) {
    const { rows } = await query('SELECT * FROM content_templates WHERE id = $1', [id]);
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

  /** Update a template */
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
    return rows[0];
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
}
