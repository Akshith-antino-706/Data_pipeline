import { Router } from 'express';
import UnifiedContactService from '../services/UnifiedContactService.js';
import UnifiedContactSync from '../services/UnifiedContactSync.js';

const router = Router();

// POST /api/v3/unified-contacts/sync — trigger incremental sync
router.post('/sync', async (_req, res, next) => {
  try {
    const result = await UnifiedContactSync.run();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/filters', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getFilterOptions();
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
    const chatDepartment = req.query.chatDepartment || undefined;
    const hasChats = req.query.hasChats || undefined;
    const hasBookings = req.query.hasBookings || undefined;
    const waStatus = req.query.waStatus || undefined;
    const emailStatus = req.query.emailStatus || undefined;
    const result = await UnifiedContactService.getAll({ page, limit, search, sortBy, sortDir, source, country,
      contactType, businessType, bookingStatus, productTier, geography, chatDepartment, hasChats, hasBookings, waStatus, emailStatus });
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

    const header = 'Name,Email,Phone,Company,Country,Status,Tier,Geography,Tours,Hotels,Visas,Flights,Revenue,Last Seen';
    const csv = [header, ...result.data.map(c =>
      `"${(c.name||'').replace(/"/g,'""')}","${c.email||''}","${c.phone||''}","${(c.company_name||'').replace(/"/g,'""')}","${c.country||''}",${c.booking_status},${c.product_tier||''},${c.geography||''},${c.total_tour_bookings||0},${c.total_hotel_bookings||0},${c.total_visa_bookings||0},${c.total_flight_bookings||0},${c.total_booking_revenue||0},"${c.last_seen_at instanceof Date ? c.last_seen_at.toISOString().slice(0,10) : (c.last_seen_at||'').toString().slice(0,10)}"`
    )].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=segment_${bookingStatus || 'all'}_customers.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segmentation-tree — 3-step decision tree dashboard data
router.get('/segmentation-tree', async (req, res, next) => {
  try {
    const data = await UnifiedContactService.getSegmentationTree({ businessType: req.query.businessType });
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

export default router;
