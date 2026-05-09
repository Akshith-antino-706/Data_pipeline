import { Router } from 'express';
import SegmentEngine from '../services/SegmentEngine.js';
const router = Router();

// Get full funnel overview (7 stages with segments + customer counts)
router.get('/funnel', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getFunnelOverview();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get complete page data (stages + segments + strategies + schema) — powers the segmentation dashboard
router.get('/page-data', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getFullPageData();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get summary stats
router.get('/summary', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getSummaryStats();
    res.json({ data });
  } catch (err) { next(err); }
});

// Run segmentation engine (assign customers to segments)
router.post('/run', async (req, res, next) => {
  try {
    const result = await SegmentEngine.runSegmentation();
    res.json({ data: result });
  } catch (err) { next(err); }
});

// "General Segment" — virtual segment covering all email- or WA-eligible
// contacts in unified_contacts. Cuts across booking_status, so we surface it
// as a separate panel in the segmentation UI. Shape:
//   {
//     emailEligible: <int>, waEligible: <int>, totalContacts: <int>,
//     journeys: [{ journey_id, name, status, total_entries, audience, ... }]
//   }
router.get('/general', async (req, res, next) => {
  try {
    const { query } = await import('../config/database.js');

    const businessType = req.query.businessType === 'B2B' || req.query.businessType === 'B2C'
      ? req.query.businessType : null;
    const btParams = businessType ? [businessType] : [];
    const btAnd = businessType ? `AND uc.contact_type = $1` : '';
    const btWhere = businessType ? `WHERE contact_type = $1` : '';

    const [emailRow, waRow, totalRow, journeysRow] = await Promise.all([
      query(`
        SELECT COUNT(*)::int AS n FROM unified_contacts uc
         WHERE uc.email IS NOT NULL AND uc.email <> ''
           AND COALESCE(uc.email_unsubscribe,'No') <> 'Yes'
           AND uc.email ~ '^[^@]+@[^@]+\\.[^@]+$'
           ${btAnd}`, btParams),
      query(`
        SELECT COUNT(*)::int AS n FROM unified_contacts uc
         WHERE uc.mobile IS NOT NULL AND uc.mobile <> ''
           AND COALESCE(uc.wa_unsubscribe,'No') <> 'Yes'
           AND COALESCE(uc.is_indian,false) = true
           ${btAnd}`, btParams),
      query(`SELECT COUNT(*)::int AS n FROM unified_contacts ${btWhere}`, btParams),
      // Treat any audience-driven journey with no saved segment as a "general broadcast"
      // journey. This catches the seed-script-created journey 120 plus any future ones.
      query(`
        SELECT journey_id, name, description, status, audience,
               total_entries, total_conversions, total_exits,
               jsonb_array_length(nodes) AS node_count,
               created_at, updated_at
          FROM journey_flows
         WHERE segment_id IS NULL
         ORDER BY updated_at DESC`),
    ]);

    res.json({
      data: {
        emailEligible: emailRow.rows[0].n,
        waEligible:    waRow.rows[0].n,
        totalContacts: totalRow.rows[0].n,
        journeys:      journeysRow.rows,
      },
    });
  } catch (err) { next(err); }
});

// Get single segment detail
router.get('/:id', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getSegmentDetail(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Segment not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Get segment customers with pagination
router.get('/:id/customers', async (req, res, next) => {
  try {
    const { page, limit, search, sortBy, sortDir } = req.query;
    const data = await SegmentEngine.getSegmentCustomers(parseInt(req.params.id), {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 25,
      search,
      sortBy,
      sortDir
    });
    res.json(data);
  } catch (err) { next(err); }
});

// Get conversion metrics for a segment
router.get('/:id/conversions', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getConversionMetrics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;
