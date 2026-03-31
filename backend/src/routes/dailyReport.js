import { Router } from 'express';
import archiver from 'archiver';
import DailyReportService from '../services/DailyReportService.js';

const router = Router();

// ── Validation Helper ──────────────────────────────────────────
function validateDateRange(req, res) {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Both "from" and "to" date query params are required (YYYY-MM-DD)' });
    return null;
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    return null;
  }
  if (fromDate > toDate) {
    res.status(400).json({ error: '"from" date must be before or equal to "to" date.' });
    return null;
  }
  const diffDays = (toDate - fromDate) / (1000 * 60 * 60 * 24);
  if (diffDays > 90) {
    res.status(400).json({ error: 'Date range cannot exceed 90 days.' });
    return null;
  }
  return { from, to };
}

const ALLOWED_TABLES = Object.keys(DailyReportService.TABLES);

// ── GET /counts — Record counts, revenue, and sync status ──────
router.get('/counts', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;

    const [tableStats, syncStatus] = await Promise.all([
      DailyReportService.getRecordCounts(dates.from, dates.to),
      DailyReportService.getSyncStatus(),
    ]);

    let totalRows = 0;
    let totalBills = 0;
    let totalSales = 0;

    const tables = {};
    for (const [key, config] of Object.entries(DailyReportService.TABLES)) {
      const stats = tableStats[key];
      totalRows += stats.totalRows;
      if (stats.totalBills) totalBills += stats.totalBills;
      if (stats.totalSales) totalSales += stats.totalSales;

      tables[key] = {
        label: config.label,
        group: config.group,
        totalRows: stats.totalRows,
        totalBills: stats.totalBills,
        totalSales: stats.totalSales,
        firstBill: stats.firstBill,
        lastBill: stats.lastBill,
        sync: syncStatus[key] || null,
      };
    }

    res.json({
      success: true,
      from: dates.from,
      to: dates.to,
      totalRows,
      totalBills,
      totalSales,
      tables,
    });
  } catch (err) {
    console.error('Daily report counts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /preview/:table — First 5 rows for data verification ───
router.get('/preview/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(', ')}` });
    }

    const dates = validateDateRange(req, res);
    if (!dates) return;

    const preview = await DailyReportService.getPreview(table, dates.from, dates.to);
    res.json({ success: true, ...preview });
  } catch (err) {
    console.error('Daily report preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /download/:table — Download single table as CSV ────────
router.get('/download/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(', ')}` });
    }

    const dates = validateDateRange(req, res);
    if (!dates) return;

    const csv = await DailyReportService.generateCSV(table, dates.from, dates.to);
    const filename = `${table}_${dates.from}_to_${dates.to}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Daily report download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /download-all — Download all tables as ZIP ─────────────
router.get('/download-all', async (req, res) => {
  try {
    const dates = validateDateRange(req, res);
    if (!dates) return;

    const filename = `rayna_daily_report_${dates.from}_to_${dates.to}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    for (const table of ALLOWED_TABLES) {
      const csv = await DailyReportService.generateCSV(table, dates.from, dates.to);
      const label = DailyReportService.TABLES[table].label.replace(/\s+/g, '_');
      archive.append(csv, { name: `${label}_${dates.from}_to_${dates.to}.csv` });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Daily report download-all error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

export default router;
