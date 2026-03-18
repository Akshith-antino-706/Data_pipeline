import db from '../config/database.js';

class CouponService {

  static async getAll() {
    const { rows } = await db.query(`
      SELECT c.*,
        CASE WHEN c.usage_limit IS NOT NULL THEN c.usage_limit - c.used_count ELSE NULL END AS remaining_uses,
        CASE WHEN c.valid_until < NOW() THEN false ELSE c.is_active END AS currently_valid
      FROM coupons c
      ORDER BY c.created_at DESC
    `);
    return rows;
  }

  static async getById(couponId) {
    const { rows: [coupon] } = await db.query('SELECT * FROM coupons WHERE coupon_id = $1', [couponId]);
    if (!coupon) return null;

    const { rows: usage } = await db.query(`
      SELECT cu.*, c.first_name, c.last_name, c.email
      FROM coupon_usage cu
      JOIN customers c ON c.customer_id = cu.customer_id
      WHERE cu.coupon_id = $1
      ORDER BY cu.used_at DESC
      LIMIT 50
    `, [couponId]);

    return { ...coupon, recent_usage: usage };
  }

  static async validate(code, { customerId, segmentLabel, channel, orderValue } = {}) {
    const { rows: [coupon] } = await db.query(
      "SELECT * FROM coupons WHERE code = $1 AND is_active = true AND (valid_until IS NULL OR valid_until >= NOW())",
      [code]
    );

    if (!coupon) return { valid: false, reason: 'Coupon not found or expired' };
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) return { valid: false, reason: 'Usage limit reached' };
    if (orderValue && coupon.min_order_value && orderValue < parseFloat(coupon.min_order_value)) {
      return { valid: false, reason: `Minimum order value is AED ${coupon.min_order_value}` };
    }

    if (segmentLabel && coupon.segment_labels?.length > 0 && !coupon.segment_labels.includes(segmentLabel)) {
      return { valid: false, reason: 'Coupon not valid for this segment' };
    }

    if (channel && coupon.channel_types?.length > 0 && !coupon.channel_types.includes(channel)) {
      return { valid: false, reason: 'Coupon not valid for this channel' };
    }

    // Check if customer already used this coupon
    if (customerId) {
      const { rows: [existing] } = await db.query(
        'SELECT 1 FROM coupon_usage WHERE coupon_id = $1 AND customer_id = $2', [coupon.coupon_id, customerId]
      );
      if (existing) return { valid: false, reason: 'Customer already used this coupon' };
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (orderValue || 0) * parseFloat(coupon.discount_value) / 100;
      if (coupon.max_discount) discount = Math.min(discount, parseFloat(coupon.max_discount));
    } else {
      discount = parseFloat(coupon.discount_value);
    }

    return { valid: true, coupon, discount_amount: discount };
  }

  static async apply(code, { customerId, bookingId, campaignId, channel, orderValue }) {
    const validation = await this.validate(code, { customerId, channel, orderValue });
    if (!validation.valid) return validation;

    await db.query(
      `INSERT INTO coupon_usage (coupon_id, customer_id, booking_id, campaign_id, channel, discount_applied)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [validation.coupon.coupon_id, customerId, bookingId, campaignId, channel, validation.discount_amount]
    );

    await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE coupon_id = $1', [validation.coupon.coupon_id]);

    return { applied: true, discount_amount: validation.discount_amount, coupon: validation.coupon };
  }

  static async create({ code, description, discountType, discountValue, minOrderValue, maxDiscount, validUntil, usageLimit, segmentLabels, channelTypes, productTypes }) {
    const { rows: [coupon] } = await db.query(`
      INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_discount, valid_until, usage_limit, segment_labels, channel_types, product_types)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [code, description, discountType, discountValue, minOrderValue, maxDiscount, validUntil, usageLimit, segmentLabels, channelTypes, productTypes]);
    return coupon;
  }

  static async update(couponId, { code, description, discountType, discountValue, minOrderValue, maxDiscount, validUntil, usageLimit, isActive }) {
    const { rows: [coupon] } = await db.query(`
      UPDATE coupons SET
        code = COALESCE($2, code),
        description = COALESCE($3, description),
        discount_type = COALESCE($4, discount_type),
        discount_value = COALESCE($5, discount_value),
        min_order_value = COALESCE($6, min_order_value),
        max_discount = COALESCE($7, max_discount),
        valid_until = COALESCE($8, valid_until),
        usage_limit = COALESCE($9, usage_limit),
        is_active = COALESCE($10, is_active)
      WHERE coupon_id = $1
      RETURNING *
    `, [couponId, code, description, discountType, discountValue, minOrderValue, maxDiscount, validUntil, usageLimit, isActive]);
    return coupon;
  }

  static async delete(couponId) {
    // Delete usage records first, then the coupon
    await db.query('DELETE FROM coupon_usage WHERE coupon_id = $1', [couponId]);
    const { rowCount } = await db.query('DELETE FROM coupons WHERE coupon_id = $1', [couponId]);
    return rowCount > 0;
  }

  static async getForSegment(segmentLabel) {
    const { rows } = await db.query(`
      SELECT * FROM coupons
      WHERE is_active = true AND (valid_until IS NULL OR valid_until >= NOW())
        AND ($1 = ANY(segment_labels) OR segment_labels IS NULL OR array_length(segment_labels, 1) IS NULL)
      ORDER BY discount_value DESC
    `, [segmentLabel]);
    return rows;
  }
}

export default CouponService;
