/**
 * JourneyTemplateQAService — regenerate the stored Email QA report for every
 * template attached to a journey action node.
 *
 * The Day templates are re-rendered fresh by Claude each morning (the 3 AM
 * daily-AI-templates cron), so their QA report must be re-run daily on the new
 * content. This enumerates the distinct templates used across ALL journeys'
 * action nodes, renders each with the same sample context the QA endpoint uses,
 * runs analyzeEmail(), and upserts email_qa_reports (one row per template_id) —
 * exactly what POST /api/v3/test-sends/analyze-email does, but in bulk.
 */
import db from '../config/database.js';
import { resolveTemplateHtml } from '../routes/testSends.js';
import { analyzeEmail } from './EmailQAService.js';

// Same sample contact the analyze-email route uses, so {{placeholders}} resolve
// and the scan matches what a real recipient would receive.
const SAMPLE_CTX = {
  contact: { id: 0, name: 'Vaibhav Sharma', email: 'guest@raynatours.com', city: 'Dubai', country: 'UAE', is_indian: false, booking_status: 'PROSPECT' },
  event: {}, payload: {},
};

/** Distinct template ids referenced by any journey's action nodes. */
export async function journeyTemplateIds() {
  const { rows } = await db.query(`
    SELECT DISTINCT COALESCE(
             NULLIF(n->'data'->>'emailTemplateId',''),
             NULLIF(n->'data'->>'templateId','')
           ) AS tid
    FROM journey_flows jf, jsonb_array_elements(jf.nodes) n
    WHERE n->>'type' = 'action'
      AND COALESCE(
            NULLIF(n->'data'->>'emailTemplateId',''),
            NULLIF(n->'data'->>'templateId','')
          ) IS NOT NULL
  `);
  return [...new Set(rows.map(r => parseInt(r.tid)).filter(Boolean))];
}

/** Regenerate + store the QA report for every journey-attached template. */
export async function regenerateJourneyTemplateReports() {
  const ids = await journeyTemplateIds();
  let ok = 0, failed = 0, skipped = 0;

  for (const templateId of ids) {
    try {
      const resolved = await resolveTemplateHtml(templateId, SAMPLE_CTX);
      if (!resolved?.html) { skipped++; continue; }
      const report = await analyzeEmail({ html: resolved.html, subject: resolved.subject });
      await db.query(
        `INSERT INTO email_qa_reports (template_id, report, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (template_id) DO UPDATE SET report = $2, placement = NULL, updated_at = NOW()`,
        [templateId, JSON.stringify(report)]
      );
      ok++;
    } catch (err) {
      failed++;
      console.error(`[QA regen] template ${templateId}: ${err.message}`);
    }
  }

  const summary = { total: ids.length, ok, failed, skipped };
  console.log('[QA regen] done:', JSON.stringify(summary));
  return summary;
}

export default { regenerateJourneyTemplateReports, journeyTemplateIds };
