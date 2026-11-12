import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { QueryRequest } from '../types/routesCommon.js';
import SegmentEngine from '../services/SegmentEngine.js';
import type { GeneralCounts, CountNRow } from '../types/u5Routes.js';
import { clampInt, MAX_PAGE } from '../utils/validate.js';
const router = Router();

/** /general counts: fresh for 5 minutes per audience. */
const GENERAL_COUNTS_TTL = 300;

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
    const data: unknown = await SegmentEngine.getSummaryStats();
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
//   { emailEligible: <int>, waEligible: <int>, totalContacts: <int> }
router.get('/general', async (req, res, next) => {
  try {
    const { query } = await import('../config/database.js');
    const { cached } = await import('../config/cache.js');
    const { parseBusinessType } = await import('../utils/contactTypes.js');
    const businessType = parseBusinessType(req.query.businessType) || null;
    const btParams = businessType ? [businessType] : [];
    const btAnd = businessType ? `AND uc.contact_type = $1` : '';
    const btWhere = businessType ? `WHERE contact_type = $1` : '';

    // Three COUNT(*) passes over unified_contacts (~1.7M rows) — cached for 5 minutes per
    // audience through the shared Redis cache so the Segments page doesn't re-scan on every open.
    const counts = await cached<GeneralCounts>(`general_counts:${businessType || 'all'}`, async () => {
      const [emailRow, waRow, totalRow] = await Promise.all([
        query<CountNRow>(`
          SELECT COUNT(*)::int AS n FROM unified_contacts uc
           WHERE uc.email IS NOT NULL AND uc.email <> ''
             AND COALESCE(uc.email_unsubscribe,'No') <> 'Yes'
             AND uc.email ~ '^[^@]+@[^@]+\\.[^@]+$'
             ${btAnd}`, btParams),
        query<CountNRow>(`
          SELECT COUNT(*)::int AS n FROM unified_contacts uc
           WHERE uc.mobile IS NOT NULL AND uc.mobile <> ''
             AND COALESCE(uc.wa_unsubscribe,'No') <> 'Yes'
             AND COALESCE(uc.is_indian,false) = true
             ${btAnd}`, btParams),
        query<CountNRow>(`SELECT COUNT(*)::int AS n FROM unified_contacts ${btWhere}`, btParams),
      ]);
      return { emailEligible: emailRow.rows[0].n, waEligible: waRow.rows[0].n, totalContacts: totalRow.rows[0].n };
    }, GENERAL_COUNTS_TTL);

    res.json({ data: counts });
  } catch (err) { next(err); }
});

// Get single segment detail
router.get('/:id', async (req, res, next) => {
  try {
    const data: unknown = await SegmentEngine.getSegmentDetail(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Segment not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Get segment customers with pagination
router.get('/:id/customers', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, search, sortBy, sortDir } = req.query;
    const data = await SegmentEngine.getSegmentCustomers(parseInt(req.params.id), {
      page: clampInt(page, 1, MAX_PAGE),
      limit: clampInt(limit, 25, 500),
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
