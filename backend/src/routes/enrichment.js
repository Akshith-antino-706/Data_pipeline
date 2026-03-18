import { Router } from 'express';
import { DataCleaningService } from '../services/DataCleaningService.js';

const router = Router();

// POST /api/v2/enrichment/run — run enrichment on all customers
router.post('/run', async (req, res, next) => {
  try {
    const result = await DataCleaningService.enrichAllCustomers();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/v2/enrichment/stats — enrichment statistics
router.get('/stats', async (req, res, next) => {
  try {
    const data = await DataCleaningService.getEnrichmentStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/enrichment/preview — preview cleaning for a single record
router.post('/preview', async (req, res, next) => {
  try {
    const { phone, email, name } = req.body;
    const result = {
      phone: DataCleaningService.cleanPhone(phone),
      email: DataCleaningService.cleanEmail(email),
      gender: DataCleaningService.inferGender(name),
    };
    if (result.phone?.countryInfo) {
      result.inferredNationality = result.phone.countryInfo.nationality;
      result.inferredCountry = result.phone.countryInfo.country;
    }
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export default router;
