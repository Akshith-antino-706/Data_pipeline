import { Router } from 'express';
import UnifiedContactService from '../services/UnifiedContactService.js';
import UnifiedContactBuilder from '../services/UnifiedContactBuilder.js';
import { invalidate } from '../config/cache.js';

const router = Router();

// POST /api/v3/unified-contacts — create a new contact (booking_status defaults to PROSPECT)
router.post('/', async (req, res, next) => {
  try {
    const contact = await UnifiedContactService.createContact(req.body);
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

router.get('/stats', async (req, res, next) => {
  try {
    const data = await UnifiedContactService.getStats({ businessType: req.query.businessType });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/filters', async (req, res, next) => {
  try {
    const data = await UnifiedContactService.getFilterOptions({ businessType: req.query.businessType });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const search = req.query.search ? String(req.query.search).slice(0, 200).trim() : undefined;
    const { sortBy, sortDir } = req.query;
    const source = req.query.source || undefined;
    const country = req.query.country || undefined;
    const contactType = req.query.contactType || undefined;
    const businessType = req.query.businessType || undefined;
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
router.get('/segment-changes', async (req, res, next) => {
  try {
    const data = await UnifiedContactService.getSegmentChanges();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-activity — daily segment activity log
router.get('/segment-activity', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const segment = req.query.segment || undefined;
    const businessType = req.query.businessType || undefined;
    const data = await UnifiedContactService.getSegmentDailyLog({ days, segment, businessType });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-activity/download — CSV download of daily log
router.get('/segment-activity/download', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const segment = req.query.segment || undefined;
    const businessType = req.query.businessType || undefined;
    const data = await UnifiedContactService.getSegmentDailyLog({ days, segment, businessType });
    const rows = data.logs;

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
router.get('/segment-customers/download', async (req, res, next) => {
  try {
    const { bookingStatus, productTier, geography } = req.query;
    const result = await UnifiedContactService.getSegmentCustomers({
      bookingStatus, productTier, geography, page: 1, limit: 10000,
    });

    const header = 'Name,Email,Mobile,Country,Contact Type,Status,Tier,Geography,Sources';
    const csv = [header, ...result.data.map(c =>
      `"${(c.name||'').replace(/"/g,'""')}","${c.email||''}","${c.mobile||''}","${c.country||''}",${c.contact_type||''},${c.booking_status},${c.product_tier||''},${c.geography||''},"${c.sources||''}"`
    )].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=segment_${bookingStatus || 'all'}_customers.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segmentation-tree — 3-step decision tree dashboard data
router.get('/segmentation-tree', async (req, res, next) => {
  try {
    const { businessType, dateFrom, dateTo } = req.query;
    const data = await UnifiedContactService.getSegmentationTree({ businessType, dateFrom, dateTo });
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
router.get('/segment-customers', async (req, res, next) => {
  try {
    const { bookingStatus, productTier, geography, businessType, page, limit, search } = req.query;
    const result = await UnifiedContactService.getSegmentCustomers({
      bookingStatus, productTier, geography, businessType,
      page: parseInt(page) || 1, limit: parseInt(limit) || 25, search,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const contact = await UnifiedContactService.getById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
});

// GET /:id/journeys — journeys this contact is enrolled in (via journey_entries)
router.get('/:id/journeys', async (req, res, next) => {
  try {
    const db = (await import('../config/database.js')).default;
    const { rows } = await db.query(`
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
      WHERE je.customer_id = $1
      ORDER BY je.entered_at DESC NULLS LAST
    `, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// PATCH /api/v3/unified-contacts/:id — update editable contact fields
router.patch('/:id', async (req, res, next) => {
  try {
    const updated = await UnifiedContactService.updateContact(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/v3/unified-contacts/:id — permanently delete a contact
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await UnifiedContactService.deleteContact(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, id: deleted.id });
  } catch (err) { next(err); }
});

export default router;
