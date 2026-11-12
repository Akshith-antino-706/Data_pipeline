import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { UnifiedContactFields } from '../types/syncAUnifiedContact.js';
import type { SourceCountRow, SegmentDailyLogCsvRow, SegmentCustomerCsvRow, UserProductRecommendationRow, RecommendedProductRow, NodeEngagement, NodeEngagementRow, ContactJourneyRow } from '../types/u3UnifiedContactsRoutes.js';
import type { QueryRequest } from '../types/routesCommon.js';
import UnifiedContactService from '../services/UnifiedContactService.js';
import UnifiedContactBuilder from '../services/UnifiedContactBuilder.js';
import ContactActivityService from '../services/ContactActivityService.js';
import { invalidate, cached } from '../config/cache.js';
import { parseBusinessType } from '../utils/contactTypes.js';
import { csvField, clampInt, MAX_PAGE } from '../utils/validate.js';

const router = Router();

// POST /api/v3/unified-contacts — create a new contact (booking_status defaults to PROSPECT)
router.post('/', async (req, res, next) => {
  try {
    const contact: unknown = await UnifiedContactService.createContact(req.body as UnifiedContactFields);
    res.status(201).json({ success: true, data: contact });
  } catch (err) { next(err); }
});

// POST /api/v3/unified-contacts/sync — trigger full rebuild (extract → link → segment)
router.post('/sync', async (_req, res, next) => {
  try {
    const result = await UnifiedContactBuilder.rebuild();
    await invalidate('dashboard:*');
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/v3/unified-contacts/registration-sync — link affiliate / agent / guest registrations
// to contacts now (the cron does this daily after the 00:30 registration sync).
//   ?full=1    every registration, not just unlinked / recently changed ones
//   ?dryRun=1  report what would change, write nothing (waits for the result)
router.post('/registration-sync', async (req, res, next) => {
  try {
    const { default: RegistrationContactSync } = await import('../services/RegistrationContactSync.js');
    const full = req.query.full === '1' || req.query.full === 'true';
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    if (RegistrationContactSync.isRunning()) return res.json({ success: true, started: false, message: 'Already running' });
    if (dryRun) return res.json({ success: true, ...(await RegistrationContactSync.run({ full, dryRun })) });
    RegistrationContactSync.run({ full })
      .then(() => invalidate('dashboard:*'))
      .catch(() => { /* logged + recorded in sync_metadata */ });
    res.status(202).json({ success: true, started: true });
  } catch (err) { next(err); }
});

router.get('/stats', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const businessType = parseBusinessType(req.query.businessType);
    // ?quick=1: only total_contacts + conversations_7d (Home); everything else gets the full stats.
    const quick = req.query.quick === '1';
    const compute = () => (quick ? UnifiedContactService.getQuickStats({ businessType }) : UnifiedContactService.getStats({ businessType }));
    // getStats scans unified_contacts, the booking tables and chats on every call. The
    // dashboard passes ?cached=1 to read a 10-min cached copy instead; every other caller
    // (e.g. the Contacts page) still gets live numbers exactly as before.
    const data: unknown = req.query.cached === '1'
      ? await cached(`contacts:stats:${quick ? 'quick:' : ''}${businessType || 'all'}`, compute, 600)
      : await compute();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/filters', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const data = await UnifiedContactService.getFilterOptions({ businessType: parseBusinessType(req.query.businessType) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// Contacts grouped by source. Optional ?date=YYYY-MM-DD scopes to contacts ADDED on that
// Dubai calendar day (created_at); otherwise all-time. Returns per-source counts + total.
// Cached 10 min (breakdown moves slowly; past-date results are immutable). Declared before
// '/:id' so 'sources-breakdown' isn't parsed as a contact id.
router.get('/sources-breakdown', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const db = (await import('../config/database.js')).default;
    const { cached } = await import('../config/cache.js');
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const from = re.test(req.query.from || '') ? req.query.from : null;
    const to   = re.test(req.query.to   || '') ? req.query.to   : null;

    const compute = async () => {
      const params: string[] = [];
      const conds: string[] = [];
      // Filter by the Dubai calendar day the contact was added (created_at). from/to are
      // inclusive; either bound may be omitted for open-ended ranges.
      // Compare created_at against Dubai-day boundaries (not a per-row cast) so an index on
      // created_at can be used. Same semantics: from/to are inclusive Dubai calendar days.
      if (from) { params.push(from); conds.push(`created_at >= ($${params.length}::date::timestamp AT TIME ZONE 'Asia/Dubai')`); }
      if (to)   { params.push(to);   conds.push(`created_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await db.query<SourceCountRow>(`
        SELECT COALESCE(NULLIF(TRIM(sources), ''), '(unknown)') AS source, COUNT(*)::int AS count
        FROM unified_contacts
        ${where}
        GROUP BY COALESCE(NULLIF(TRIM(sources), ''), '(unknown)')
        ORDER BY count DESC
      `, params);
      const total = rows.reduce((s, r) => s + r.count, 0);
      return { from, to, total, sources: rows };
    };

    const data = req.query.fresh
      ? await compute()
      : await cached(`contacts:sources-breakdown:${from || 'all'}:${to || 'all'}`, compute, 600);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.min(MAX_PAGE, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const search = req.query.search ? String(req.query.search).slice(0, 200).trim() : undefined;
    const { sortBy, sortDir } = req.query;
    const source = req.query.source || undefined;
    const country = req.query.country || undefined;
    const contactType = parseBusinessType(req.query.contactType);
    const businessType = parseBusinessType(req.query.businessType);
    const bookingStatus = req.query.bookingStatus || undefined;
    const productTier = req.query.productTier || undefined;
    const geography = req.query.geography || undefined;
    const hasBookings = req.query.hasBookings || undefined;
    const waStatus = req.query.waStatus || undefined;
    const emailStatus = req.query.emailStatus || undefined;
    const bookingDateFrom = req.query.bookingDateFrom || undefined;
    const bookingDateTo = req.query.bookingDateTo || undefined;
    const travelDateFrom = req.query.travelDateFrom || undefined;
    const travelDateTo = req.query.travelDateTo || undefined;
    const result = await UnifiedContactService.getAll({ page, limit, search, sortBy, sortDir, source, country,
      contactType, businessType, bookingStatus, productTier, geography, hasBookings, waStatus, emailStatus,
      bookingDateFrom, bookingDateTo, travelDateFrom, travelDateTo });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// POST /api/v3/unified-contacts/snapshot-daily — manually snapshot today's segment counts
router.post('/snapshot-daily', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.snapshotDailySegments();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-changes — before/after comparison from latest two snapshots
router.get('/segment-changes', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const data = await UnifiedContactService.getSegmentChanges();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-activity — daily segment activity log
router.get('/segment-activity', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const segment = req.query.segment || undefined;
    const businessType = parseBusinessType(req.query.businessType);
    const includeLive = !(req.query.includeLive === '0' || req.query.includeLive === 'false');
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const data = await UnifiedContactService.getSegmentDailyLog({ days, segment, businessType, includeLive, fresh });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-activity/download — CSV download of daily log
router.get('/segment-activity/download', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const segment = req.query.segment || undefined;
    const businessType = parseBusinessType(req.query.businessType);
    const data = await UnifiedContactService.getSegmentDailyLog({ days, segment, businessType });
    const rows = data.logs as SegmentDailyLogCsvRow[];

    const header = 'Date,Segment,Total,Entered,Exited,Converted,Emails Sent,WhatsApp Sent,Push Sent,Total Reached,Journey Active,Journey Completed,Revenue';
    const csv = [header, ...rows.map(r =>
      `${r.log_date instanceof Date ? r.log_date.toISOString().slice(0,10) : String(r.log_date||'').slice(0,10)},${r.segment_label},${r.total_count},${r.entered},${r.exited},${r.converted},${r.emails_sent},${r.whatsapp_sent},${r.push_sent},${r.total_reached},${r.journey_active},${r.journey_completed},${r.revenue}`
    )].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=segment_activity_${days}d.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-customers/download — CSV download of segment customers
router.get('/segment-customers/download', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const { bookingStatus, productTier, geography } = req.query;
    const businessType = parseBusinessType(req.query.businessType);
    const result = await UnifiedContactService.getSegmentCustomers({
      bookingStatus, productTier, geography, businessType, page: 1, limit: 10000,
    });

    const header = 'Name,Email,Mobile,Country,Contact Type,Status,Tier,Geography,Sources';
    const csv = [header, ...(result.data as SegmentCustomerCsvRow[]).map(c =>
      [c.name, c.email, c.mobile, c.country, c.contact_type, c.booking_status, c.product_tier, c.geography, c.sources].map(csvField).join(',')
    )].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=segment_${bookingStatus || 'all'}_customers.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segmentation-tree — 3-step decision tree dashboard data
router.get('/segmentation-tree', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const { dateFrom, dateTo, travelFrom, travelTo, bookingFrom, bookingTo, product } = req.query;
    const businessType = parseBusinessType(req.query.businessType);
    const data = await UnifiedContactService.getSegmentationTree({ businessType, dateFrom, dateTo, travelFrom, travelTo, bookingFrom, bookingTo, product });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// POST /api/v3/unified-contacts/recompute-segmentation — rerun segmentation rules
router.post('/recompute-segmentation', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.recomputeSegmentation();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-customers — customers for a specific segment combo
router.get('/segment-customers', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const { bookingStatus, productTier, geography, page, limit, search } = req.query;
    const businessType = parseBusinessType(req.query.businessType);
    const result = await UnifiedContactService.getSegmentCustomers({
      bookingStatus, productTier, geography, businessType,
      page: clampInt(page, 1, MAX_PAGE), limit: clampInt(limit, 25, 500), search,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /:id/bookings?type=tours&page=1&limit=20 — one page of a contact's bookings of one type.
// The profile loads only the latest 20 per type; this pages through the rest on demand.
router.get('/:id/bookings', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const type = String(req.query.type ?? '');
    if (!UnifiedContactService.BOOKING_TABLES[type]) {
      return res.status(400).json({ success: false, error: `type must be one of ${Object.keys(UnifiedContactService.BOOKING_TABLES).join(', ')}` });
    }
    const result = await UnifiedContactService.getBookings(
      req.params.id, type, clampInt(req.query.page, 1, MAX_PAGE), clampInt(req.query.limit, 20, 100),
    );
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /:id?bookings=N — N latest bookings per type are embedded (default 20; the profile pages the
// rest through /:id/bookings). Callers that still want the old long lists pass bookings=500.
router.get('/:id', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const contact: unknown = await UnifiedContactService.getById(req.params.id, clampInt(req.query.bookings, 20, 500));
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
});

// GET /:id/recommendations — most recent AI recommendation row for this contact,
// with the 5 product_ids hydrated into full product objects.
// Returns { recommendation: <row> | null } — frontend hides the section on null.
router.get('/:id/recommendations', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const db = (await import('../config/database.js')).default;
    const unifiedId = parseInt(req.params.id, 10);
    if (!unifiedId) return res.status(400).json({ error: 'Invalid unified_id' });

    // Most recently computed row for this user (any recommendation_type).
    const { rows: recRows } = await db.query<UserProductRecommendationRow>(`
      SELECT unified_id, recommendation_type, based_on_booking_id, based_on_product_id,
             destination_city, product_ids, source, rationale,
             computed_at, expires_at
      FROM user_product_recommendations
      WHERE unified_id = $1 AND expires_at > NOW()
      ORDER BY computed_at DESC
      LIMIT 1
    `, [unifiedId]);

    if (recRows.length === 0) return res.json({ recommendation: null });
    const rec = recRows[0];

    // Hydrate the ordered product_ids into full product rows.
    const ids: number[] = Array.isArray(rec.product_ids) ? rec.product_ids.map(Number) : [];
    let products: RecommendedProductRow[] = [];
    if (ids.length > 0) {
      const { rows: prodRows } = await db.query<RecommendedProductRow>(`
        SELECT product_id, name, category, city, image_url AS image, url,
               sale_price, normal_price, listing_rating
        FROM products WHERE product_id = ANY($1::int[])
      `, [ids]);
      const byId = new Map(prodRows.map(p => [p.product_id, p]));
      products = ids.map(id => byId.get(id)).filter(Boolean) as RecommendedProductRow[];
    }

    // Look up the "based_on" product name (their original booking) for the meta line.
    let basedOnName: string | null = null;
    if (rec.based_on_product_id) {
      const { rows: [b] } = await db.query<{ name: string | null }>(
        `SELECT name FROM products WHERE product_id::text = $1 LIMIT 1`,
        [String(rec.based_on_product_id)]
      );
      basedOnName = b?.name || null;
    }

    res.json({
      recommendation: {
        recommendationType: rec.recommendation_type,
        destinationCity: rec.destination_city,
        basedOnProductId: rec.based_on_product_id,
        basedOnProductName: basedOnName,
        source: rec.source,
        rationale: rec.rationale,
        computedAt: rec.computed_at,
        expiresAt: rec.expires_at,
        products,
      },
    });
  } catch (err) { next(err); }
});

// GET /:id/journeys — journeys this contact is enrolled in (via journey_entries)
// Optional ?page=&limit= — when given, one page of journeys (newest enrolment first) plus total/
// totalPages, and node engagement is read only for the journeys on that page. Without them the
// full list is returned as before.
router.get('/:id/journeys', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const db = (await import('../config/database.js')).default;
    const paged = req.query.page !== undefined || req.query.limit !== undefined;
    const limit = clampInt(req.query.limit, 10, 100);
    const page = clampInt(req.query.page, 1, MAX_PAGE);
    // ?q= matches the journey name or exact #id; ?engagement= keeps only journeys where THIS contact
    // had an email with that outcome. Both are parameterised — nothing from the query is interpolated.
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^#/, '').slice(0, 100) : '';
    const engagement = typeof req.query.engagement === 'string' ? req.query.engagement : '';
    const ENGAGEMENT_SQL: Record<string, string> = {
      sent: "(e.sent_at IS NOT NULL OR e.status IN ('sent','opened','clicked'))",
      delivered: "(e.sent_at IS NOT NULL OR e.status IN ('sent','opened','clicked'))",
      opened: 'e.opened_at IS NOT NULL',
      clicked: 'e.clicked_at IS NOT NULL',
      failed: "e.status = 'failed'",
    };
    if (engagement && !ENGAGEMENT_SQL[engagement]) {
      return res.status(400).json({ success: false, error: `engagement must be one of ${Object.keys(ENGAGEMENT_SQL).join(', ')}` });
    }
    const params: unknown[] = [req.params.id];
    const where: string[] = ['je.customer_id = $1'];
    if (q) {
      params.push(`%${q}%`, q);
      where.push(`(jf.name ILIKE $${params.length - 1} OR jf.journey_id::text = $${params.length})`);
    }
    if (engagement) {
      where.push(`EXISTS (SELECT 1 FROM email_send_log e WHERE e.unified_id = $1 AND e.journey_id = je.journey_id AND ${ENGAGEMENT_SQL[engagement]})`);
    }
    const whereSql = where.join(' AND ');
    let total: number | null = null;
    if (paged) {
      const { rows: [c] } = await db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM journey_entries je JOIN journey_flows jf ON jf.journey_id = je.journey_id WHERE ${whereSql}`, params);
      total = parseInt(c?.total ?? '0', 10) || 0;
    }
    const pageParams = paged ? [...params, limit, (page - 1) * limit] : params;
    const { rows } = await db.query<ContactJourneyRow>(`
      SELECT
        jf.journey_id,
        jf.name,
        jf.status                                    AS journey_status,
        je.status                                    AS entry_status,
        je.exit_reason,
        je.current_node_id,
        je.entered_at,
        je.completed_at
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      WHERE ${whereSql}
      ORDER BY je.entered_at DESC NULLS LAST
      ${paged ? `LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : ''}
    `, pageParams);
    const pageJourneyIds = rows.map(r => Number(r.journey_id)).filter(n => Number.isFinite(n));

    // Per-node email engagement (delivered / opened / clicked) for THIS contact,
    // pulled from email_send_log keyed by unified_id + journey_id + node_id.
    const { rows: nodeRows } = await db.query<NodeEngagementRow>(`
      SELECT
        journey_id,
        node_id,
        MAX(COALESCE(template_label, subject))                                  AS label,
        MAX(subject)                                                            AS subject,
        MAX(day_number)                                                         AS day_number,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL
                            OR status IN ('sent','opened','clicked'))           AS delivered,
        COUNT(*) FILTER (WHERE opened_at  IS NOT NULL)                          AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)                          AS clicked,
        MIN(sent_at)                                                            AS sent_at,
        MIN(opened_at)                                                          AS opened_at,
        MIN(clicked_at)                                                         AS clicked_at
      FROM email_send_log
      WHERE unified_id = $1 AND journey_id IS NOT NULL ${paged ? 'AND journey_id = ANY($2::int[])' : ''}
      GROUP BY journey_id, node_id
      ORDER BY journey_id, MIN(sent_at) NULLS LAST
    `, paged ? [req.params.id, pageJourneyIds] : [req.params.id]);

    const nodesByJourney: Record<string, NodeEngagement[]> = {};
    for (const n of nodeRows) {
      (nodesByJourney[n.journey_id] ||= []).push({
        node_id:    n.node_id,
        label:      n.label,
        subject:    n.subject,
        day_number: n.day_number,
        delivered:  Number(n.delivered) > 0,
        opened:     Number(n.opened)    > 0,
        clicked:    Number(n.clicked)   > 0,
        sent_at:    n.sent_at,
        opened_at:  n.opened_at,
        clicked_at: n.clicked_at,
      });
    }
    for (const j of rows) j.nodes = nodesByJourney[j.journey_id] || [];

    if (total !== null) return res.json({ success: true, data: rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /:id/activity?page=1&limit=30&kind=message — one page of the merged activity timeline
// (emails, bookings, website events, chats, profile milestones), newest first, sorted on the server.
router.get('/:id/activity', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const result = await ContactActivityService.getActivity(req.params.id, {
      page: clampInt(req.query.page, 1, MAX_PAGE), limit: clampInt(req.query.limit, 30, 100),
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// PATCH /api/v3/unified-contacts/:id — update editable contact fields
router.patch('/:id', async (req, res, next) => {
  try {
    const updated: unknown = await UnifiedContactService.updateContact(req.params.id, req.body as UnifiedContactFields);
    if (!updated) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/v3/unified-contacts/:id — permanently delete a contact
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await UnifiedContactService.deleteContact(req.params.id) as { id: number } | null;
    if (!deleted) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { next(err); }
});

export default router;
