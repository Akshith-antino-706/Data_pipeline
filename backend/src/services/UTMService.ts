import crypto from 'crypto';
import db from '../config/database.js';
import { clampInt, MAX_PAGE } from '../utils/validate.js';
import type { UtmCampaignRow, UtmCampaignWithLinkRow, UtmIdRow, UtmSegmentLabelRow, UtmSegmentListRow, UtmTrackingRow, UtmChannelSummaryRow, UtmSegmentSummaryRow, UtmCustomerRow, UserUtmLinkRow, UserUtmLinkListRow, UserUtmLinkStatsRow, UserUtmCampaignStatsRow, UserUtmTotalsRow } from '../types/u6Services.js';

type Id = number | string;

interface BuildUTMInput {
  baseUrl?: string;
  channel?: string | null;
  campaignName?: string | null;
  segmentLabel?: string | null;
  campaignId?: Id;
  contentNumber?: number;
  journeyId?: Id;
  nodeId?: string;
}

interface JourneyNodeRef {
  journeyId?: Id;
  nodeId?: string;
}

interface UTMAnalyticsFilters {
  segmentLabel?: unknown;
  channel?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  /** Optional paging: when `page` or `limit` is sent, `links` is one page and `total` is added. */
  page?: unknown;
  limit?: unknown;
  /** Optional text search over campaign / template / segment name (paged mode only). */
  search?: unknown;
}

interface UserLinkFilters {
  campaignId?: unknown;
  segment?: unknown;
  clicked?: unknown;
  search?: unknown;
  limit?: unknown;
  offset?: unknown;
  /** Optional 1-based page; when sent, offset = (page - 1) * limit. */
  page?: unknown;
}

/** Upper bound for one page of links (old callers got up to 200 at once). */
const MAX_LINKS_LIMIT = 200;
const MAX_OFFSET = MAX_PAGE * MAX_LINKS_LIMIT;

/** Escape LIKE wildcards so a search for "50%" matches the text literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * UTM Tracking Service — Campaign-Centric + Per-User Links
 * Every campaign gets a UTM link. Templates feed into campaigns.
 * Per-user links add a unique token per contact so we know exactly WHO clicked.
 * Format: ?utm_source=AI_marketer&utm_medium=[channel]&utm_campaign=[campaign_name]_[segment]&utm_content=[channel]_[campaign_id]&rid=[unified_id]
 */
class UTMService {

  static BASE_URL = 'https://www.raynatours.com/activities';

  /** Generate a short unique token (URL-safe, 10 chars) */
  static generateToken() {
    return crypto.randomBytes(15).toString('base64url').slice(0, 10);
  }

  /**
   * Build a UTM URL
   */
  static buildUTM({ baseUrl, channel, campaignName, segmentLabel, campaignId, contentNumber = 1, journeyId, nodeId }: BuildUTMInput) {
    const base = baseUrl || this.BASE_URL;
    const medium = channel || 'email';
    const campaign = `${(campaignName || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_')}_${(segmentLabel || 'all').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    let content = campaignId ? `${medium}_camp${campaignId}` : `${medium}_${contentNumber}`;

    // Append journey info to utm_content if provided
    if (journeyId) content += `_j${journeyId}`;
    if (nodeId) content += `_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const params = new URLSearchParams({
      utm_source: 'AI_marketer',
      utm_medium: medium,
      utm_campaign: campaign,
      utm_content: content
    });
    if (journeyId) params.set('journeyId', String(journeyId));
    if (nodeId) params.set('nodeId', nodeId);

    return `${base}?${params.toString()}`;
  }

  /**
   * Generate UTM link for a single campaign
   */
  static async generateForCampaign(campaignId: Id, { journeyId, nodeId }: JourneyNodeRef = {}) {
    const { rows: [campaign] } = await db.query<UtmCampaignRow>(`
      SELECT c.*, ct.cta_url AS template_cta_url
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.id = $1
    `, [campaignId]);
    if (!campaign) throw new Error('Campaign not found');

    const baseUrl = campaign.template_cta_url || this.BASE_URL;
    const fullUrl = this.buildUTM({
      baseUrl,
      channel: campaign.channel,
      campaignName: campaign.name,
      segmentLabel: campaign.segment_label,
      campaignId: campaign.id,
      journeyId,
      nodeId
    });

    // Build utm_content with journey info
    let utmContent = `${campaign.channel}_camp${campaign.id}`;
    if (journeyId) utmContent += `_j${journeyId}`;
    if (nodeId) utmContent += `_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const { rows: [utm] } = await db.query<UtmIdRow>(`
      INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url, journey_id, node_id)
      VALUES ($1, $2, $3, $4, 'AI_marketer', $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT DO NOTHING
      RETURNING utm_id
    `, [
      campaign.id,
      campaign.template_id,
      campaign.segment_label,
      campaign.channel,
      campaign.channel,
      `${campaign.name}_${campaign.segment_label}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      utmContent,
      fullUrl,
      baseUrl,
      journeyId || null,
      nodeId || null
    ]);

    // ON CONFLICT DO NOTHING returns no row when a matching link already exists; reuse that link's
    // id instead of returning undefined (which made generateUserLinks store a null utm_id).
    let utmId = utm?.utm_id;
    if (utmId === undefined) {
      const { rows: [existing] } = await db.query<UtmIdRow>(
        `SELECT utm_id FROM utm_tracking WHERE campaign_id = $1 AND full_url = $2 ORDER BY utm_id DESC LIMIT 1`,
        [campaign.id, fullUrl],
      );
      utmId = existing?.utm_id;
    }

    return { campaign_id: campaign.id, campaign_name: campaign.name, segment: campaign.segment_label, channel: campaign.channel, utm_url: fullUrl, utm_id: utmId };
  }

  /**
   * Generate UTM links for ALL campaigns in a segment
   */
  static async generateForSegment(segmentLabel: string, { journeyId, nodeId }: JourneyNodeRef = {}) {
    const { rows: campaigns } = await db.query<UtmCampaignRow>(`
      SELECT c.id, c.name, c.segment_label, c.channel::text AS channel, c.template_id,
        ct.cta_url AS template_cta_url
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.segment_label = $1
      ORDER BY c.id
    `, [segmentLabel]);

    const results: Array<Record<string, unknown>> = [];
    for (const camp of campaigns) {
      const baseUrl = camp.template_cta_url || this.BASE_URL;
      const fullUrl = this.buildUTM({
        baseUrl,
        channel: camp.channel,
        campaignName: camp.name,
        segmentLabel: camp.segment_label,
        campaignId: camp.id,
        journeyId,
        nodeId
      });

      // Build utm_content with journey info
      let utmContent = `${camp.channel}_camp${camp.id}`;
      if (journeyId) utmContent += `_j${journeyId}`;
      if (nodeId) utmContent += `_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      await db.query(`
        INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url, journey_id, node_id)
        VALUES ($1, $2, $3, $4::channel_type, 'AI_marketer', $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
      `, [
        camp.id,
        camp.template_id,
        camp.segment_label,
        camp.channel,
        camp.channel,
        `${camp.name}_${camp.segment_label}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        utmContent,
        fullUrl,
        baseUrl,
        journeyId || null,
        nodeId || null
      ]);

      results.push({
        campaign_id: camp.id,
        campaign_name: camp.name,
        channel: camp.channel,
        utm_url: fullUrl
      });
    }

    return results;
  }

  /**
   * Generate UTM links for ALL campaigns across ALL segments
   */
  static async generateForAllSegments({ journeyId, nodeId }: JourneyNodeRef = {}) {
    const { rows: segments } = await db.query<UtmSegmentLabelRow>(`
      SELECT DISTINCT segment_label FROM campaigns
      WHERE segment_label IS NOT NULL
      ORDER BY segment_label
    `);

    const results = [];
    for (const seg of segments) {
      const links = await this.generateForSegment(seg.segment_label, { journeyId, nodeId });
      results.push({ segment: seg.segment_label, links_generated: links.length });
    }

    return results;
  }

  /**
   * Get all segments with campaign + UTM stats (for dropdown/table)
   */
  static async getSegmentsList() {
    const { rows } = await db.query<UtmSegmentListRow>(`
      SELECT sd.segment_name,
        (SELECT COUNT(*) FROM campaigns c WHERE c.segment_label = sd.segment_name) AS campaign_count,
        COUNT(DISTINCT ut.utm_id) AS utm_count,
        COALESCE(SUM(ut.clicks), 0) AS total_clicks,
        COALESCE(SUM(ut.conversions), 0) AS total_conversions,
        COALESCE(SUM(ut.revenue), 0) AS total_revenue,
        (SELECT COUNT(*) FROM segment_customers sc WHERE sc.segment_id = sd.segment_id AND sc.is_active = true) AS customer_count
      FROM segment_definitions sd
      LEFT JOIN utm_tracking ut ON ut.segment_label = sd.segment_name
      GROUP BY sd.segment_id, sd.segment_name, sd.segment_number
      ORDER BY sd.segment_number
    `);
    return rows;
  }

  /**
   * Get UTM tracking data with analytics
   */
  static async getAnalytics({ segmentLabel, channel, dateFrom, dateTo, page, limit, search }: UTMAnalyticsFilters = {}) {
    let where = '1=1';
    const params: unknown[] = [];

    if (segmentLabel) { params.push(segmentLabel); where += ` AND ut.segment_label = $${params.length}`; }
    if (channel) { params.push(channel); where += ` AND ut.channel::text = $${params.length}`; }
    if (dateFrom) { params.push(dateFrom); where += ` AND ut.created_at >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); where += ` AND ut.created_at <= $${params.length}`; }

    // Paged mode is opt-in: without page/limit the response is exactly as before (newest 200, no total).
    const paged = present(page) || present(limit);
    let linkWhere = where;
    const linkParams = [...params];
    const q = typeof search === 'string' ? search.trim().slice(0, 200) : '';
    if (paged && q) {
      linkParams.push(`%${likeEscape(q)}%`);
      const n = linkParams.length;
      linkWhere += ` AND (c.name ILIKE $${n} OR ct.name ILIKE $${n} OR ut.segment_label ILIKE $${n} OR ut.utm_campaign ILIKE $${n})`;
    }
    const pageSize = paged ? clampInt(limit, 20, MAX_LINKS_LIMIT) : 200;
    const pageNo = paged ? clampInt(page, 1, MAX_PAGE) : 1;
    const pageParams = paged ? [...linkParams, pageSize, (pageNo - 1) * pageSize] : linkParams;
    const limitSql = paged ? `LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}` : 'LIMIT 200';

    const { rows } = await db.query<UtmTrackingRow>(`
      SELECT ut.*,
        ct.name AS template_name,
        c.name AS campaign_name,
        c.status AS campaign_status,
        c.target_count
      FROM utm_tracking ut
      LEFT JOIN content_templates ct ON ct.id = ut.template_id
      LEFT JOIN campaigns c ON c.id = ut.campaign_id
      WHERE ${linkWhere}
      ORDER BY ut.created_at DESC${paged ? ', ut.utm_id DESC' : ''}
      ${limitSql}
    `, pageParams);

    const { rows: summary } = await db.query<UtmChannelSummaryRow>(`
      SELECT ut.channel::TEXT, COUNT(*) AS total_links,
        SUM(ut.clicks) AS total_clicks, SUM(ut.conversions) AS total_conversions,
        SUM(ut.revenue) AS total_revenue
      FROM utm_tracking ut WHERE ${where}
      GROUP BY ut.channel
    `, params);

    // The per-segment summary is only part of the legacy (unpaged) shape; the paged UI never reads it.
    if (!paged) {
      const { rows: segmentSummary } = await db.query<UtmSegmentSummaryRow>(`
        SELECT ut.segment_label, COUNT(*) AS total_links,
          SUM(ut.clicks) AS total_clicks, SUM(ut.conversions) AS total_conversions,
          COUNT(DISTINCT ut.campaign_id) AS campaigns_tracked
        FROM utm_tracking ut WHERE ${where}
        GROUP BY ut.segment_label
        ORDER BY total_links DESC
      `, params);
      return { links: rows, summary, segmentSummary };
    }

    const { rows: countRows } = await db.query<{ total: string }>(`
      SELECT COUNT(*) AS total
      FROM utm_tracking ut
      LEFT JOIN content_templates ct ON ct.id = ut.template_id
      LEFT JOIN campaigns c ON c.id = ut.campaign_id
      WHERE ${linkWhere}
    `, linkParams);
    const total = Number(countRows[0]?.total) || 0;
    return { links: rows, summary, total, page: pageNo, limit: pageSize };
  }

  /** Record a UTM click */
  static async recordClick(utmId: Id) {
    await db.query('UPDATE utm_tracking SET clicks = clicks + 1 WHERE utm_id = $1', [utmId]);
  }

  /** Record a UTM conversion */
  static async recordConversion(utmId: Id, revenue: unknown = 0) {
    await db.query(
      'UPDATE utm_tracking SET conversions = conversions + 1, revenue = revenue + $2 WHERE utm_id = $1',
      [utmId, revenue]
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // PER-USER UTM LINKS — Unique trackable URL for each contact
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate unique links for all users in a campaign's segment.
   * Each user gets their own token → tracking URL → redirect with rid param.
   */
  static async generateUserLinks(campaignId: Id, { baseUrl: overrideBaseUrl, journeyId, nodeId }: JourneyNodeRef & { baseUrl?: string } = {}) {
    // Get campaign + its UTM link
    const { rows: [campaign] } = await db.query<UtmCampaignWithLinkRow>(`
      SELECT c.*, ct.cta_url AS template_cta_url,
        ut.utm_id, ut.full_url AS utm_full_url, ut.utm_source, ut.utm_medium, ut.utm_campaign, ut.utm_content
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      LEFT JOIN utm_tracking ut ON ut.campaign_id = c.id
      WHERE c.id = $1
    `, [campaignId]);
    if (!campaign) throw new Error('Campaign not found');

    // If no UTM link exists for this campaign, generate one first
    let utmId = campaign.utm_id;
    if (!utmId) {
      const result = await this.generateForCampaign(campaignId, { journeyId, nodeId });
      utmId = result.utm_id;
    }

    // Get all active customers in this segment
    const { rows: customers } = await db.query<UtmCustomerRow>(`
      SELECT uc.unified_id, uc.name, uc.email
      FROM unified_contacts uc
      WHERE uc.segment_label = $1
        AND uc.email IS NOT NULL
        AND uc.email_unsubscribed = false
      ORDER BY uc.unified_id
    `, [campaign.segment_label]);

    if (customers.length === 0) {
      return { campaign_id: campaignId, segment: campaign.segment_label, links_generated: 0, message: 'No eligible contacts in segment' };
    }

    const baseUrl = overrideBaseUrl || campaign.template_cta_url || this.BASE_URL;
    const generated: Array<Record<string, unknown>> = [];

    // Build utm_content with journey info
    let utmContent = `${campaign.channel || 'email'}_camp${campaign.id}`;
    if (journeyId) utmContent += `_j${journeyId}`;
    if (nodeId) utmContent += `_${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    for (const cust of customers) {
      const token = this.generateToken();

      // Build personalized destination URL with rid (Rayna ID) for GTM
      const destParams = new URLSearchParams({
        utm_source: 'AI_marketer',
        utm_medium: campaign.channel || 'email',
        utm_campaign: `${(campaign.name || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_')}_${(campaign.segment_label || 'all').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        utm_content: utmContent,
        rid: cust.unified_id  // Rayna ID — GTM reads this to identify the user
      });
      if (journeyId) destParams.set('journeyId', String(journeyId));
      if (nodeId) destParams.set('nodeId', nodeId);
      const destinationUrl = `${baseUrl}?${destParams.toString()}`;

      await db.query(`
        INSERT INTO user_utm_links (utm_id, campaign_id, unified_id, customer_email, customer_name, token, destination_url, journey_id, node_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (token) DO NOTHING
      `, [utmId, campaignId, cust.unified_id, cust.email, cust.name, token, destinationUrl, journeyId || null, nodeId || null]);

      generated.push({
        unified_id: cust.unified_id,
        name: cust.name,
        email: cust.email,
        token,
        tracking_url: `/api/v3/utm/track/${token}`,
        destination_url: destinationUrl
      });
    }

    return {
      campaign_id: campaignId,
      campaign_name: campaign.name,
      segment: campaign.segment_label,
      links_generated: generated.length,
      links: generated
    };
  }

  /**
   * Handle a click on a user tracking link.
   * Records click → returns destination URL for redirect.
   */
  static async trackClick(token: string) {
    const { rows: [link] } = await db.query<UserUtmLinkRow>(`
      UPDATE user_utm_links
      SET click_count = click_count + 1,
          first_clicked_at = COALESCE(first_clicked_at, NOW()),
          last_clicked_at = NOW()
      WHERE token = $1
      RETURNING *
    `, [token]);

    if (!link) return null;

    // Also increment the parent UTM tracking clicks
    if (link.utm_id) {
      await db.query('UPDATE utm_tracking SET clicks = clicks + 1 WHERE utm_id = $1', [link.utm_id]);
    }

    return link;
  }

  /**
   * Get user links for a campaign with click stats
   */
  static async getUserLinks({ campaignId, segment, clicked, search, limit, offset, page }: UserLinkFilters = {}) {
    let where = '1=1';
    const params: unknown[] = [];

    if (campaignId) { params.push(campaignId); where += ` AND ul.campaign_id = $${params.length}`; }
    if (segment) { params.push(segment); where += ` AND c.segment_label = $${params.length}`; }
    if (clicked === 'true') { where += ' AND ul.click_count > 0'; }
    if (clicked === 'false') { where += ' AND ul.click_count = 0'; }
    if (search) { params.push(`%${search}%`); where += ` AND (ul.customer_name ILIKE $${params.length} OR ul.customer_email ILIKE $${params.length})`; }

    // Clamp paging so a bad query value can't ask for millions of rows; defaults keep the old 200/0.
    const pageSize = clampInt(limit, 200, MAX_LINKS_LIMIT);
    const skip = present(page)
      ? (clampInt(page, 1, MAX_PAGE) - 1) * pageSize
      : clampInt(offset, 0, MAX_OFFSET, 0);
    params.push(pageSize, skip);

    const { rows } = await db.query<UserUtmLinkListRow>(`
      SELECT ul.*,
        c.name AS campaign_name, c.segment_label, c.channel
      FROM user_utm_links ul
      LEFT JOIN campaigns c ON c.id = ul.campaign_id
      WHERE ${where}
      ORDER BY ul.click_count DESC, ul.created_at DESC, ul.link_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Summary stats
    const { rows: [stats] } = await db.query<UserUtmLinkStatsRow>(`
      SELECT
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE ul.click_count > 0) AS clicked_links,
        SUM(ul.click_count) AS total_clicks,
        COUNT(DISTINCT ul.campaign_id) AS campaigns
      FROM user_utm_links ul
      LEFT JOIN campaigns c ON c.id = ul.campaign_id
      WHERE ${where.replace(` LIMIT $${params.length - 1} OFFSET $${params.length}`, '')}
    `, params.slice(0, -2));

    return { links: rows, stats };
  }

  /**
   * Get per-campaign user link stats (for the overview)
   */
  /** Totals across all personal links — one SELECT, used by the website overview tile. */
  static async getUserLinkTotals(): Promise<UserUtmTotalsRow | undefined> {
    const { rows: [totals] } = await db.query<UserUtmTotalsRow>(`
      SELECT
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE click_count > 0) AS total_clicked,
        SUM(click_count) AS total_clicks,
        COUNT(DISTINCT campaign_id) AS campaigns,
        COUNT(DISTINCT unified_id) AS unique_users
      FROM user_utm_links
    `);
    return totals;
  }

  static async getUserLinkStats() {
    const { rows } = await db.query<UserUtmCampaignStatsRow>(`
      SELECT
        ul.campaign_id,
        c.name AS campaign_name,
        c.segment_label,
        c.channel,
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE ul.click_count > 0) AS clicked,
        SUM(ul.click_count) AS total_clicks,
        MIN(ul.first_clicked_at) AS first_click,
        MAX(ul.last_clicked_at) AS last_click
      FROM user_utm_links ul
      JOIN campaigns c ON c.id = ul.campaign_id
      GROUP BY ul.campaign_id, c.name, c.segment_label, c.channel
      ORDER BY total_clicks DESC
    `);

    const totals = await UTMService.getUserLinkTotals();
    return { campaigns: rows, totals };
  }
}

export default UTMService;
