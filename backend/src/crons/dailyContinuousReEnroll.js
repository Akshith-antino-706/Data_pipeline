/**
 * dailyContinuousReEnroll
 *
 * Daily re-enrollment for CONTINUOUS (journey_type='gtm') PER-USER journeys —
 * i.e. continuous journeys with NO trigger GTM event (segment/per-user mode).
 *
 * Why: a per-user continuous journey fans out ONCE at start (_gtmFanout). After
 * that, no new segment members are added — unlike event-triggered GTM journeys,
 * which enroll in real-time via GtmJourneyService.onEvent. This cron closes that
 * gap: once a day it re-scans each per-user continuous journey's segment and
 * boards any NEW matching users at the START of the belt (the first action node),
 * so they ride the full sequence in order.
 *
 * Safety / scope:
 *   - EVENT-triggered GTM journeys are SKIPPED (they self-enroll via onEvent —
 *     "gtm event should not be disturbed"). Detected via _gtmTriggerEvents(): a
 *     non-empty event list => event journey => skip.
 *   - IDEMPOTENT: _gtmFanout enrolls via ContinuousJourneyService.enter, which is
 *     `INSERT … ON CONFLICT (journey_id, unified_id, item_id) DO NOTHING`. So users
 *     already on the belt (active) OR already finished (completed/exited) are NOT
 *     re-added — only brand-new segment matches get an entry.
 *   - Dynamic segments (e.g. travel_date relative to CURRENT_DATE) self-update, so
 *     each daily run naturally picks up the day's newly-qualifying users.
 *
 * Registered in server.js to run once a day (Asia/Dubai). Exported for manual runs.
 */

import db from '../config/database.js';
import JourneyService from '../services/JourneyService.js';

export async function runDailyContinuousReEnroll() {
  const { rows: journeys } = await db.query(
    `SELECT * FROM journey_flows WHERE status = 'active' AND journey_type = 'gtm'`
  );

  let perUserJourneys = 0, added = 0, eventSkipped = 0, errors = 0;
  for (const j of journeys) {
    try {
      // Event-triggered GTM journeys enroll in real time via onEvent — DO NOT disturb them.
      const events = await JourneyService._gtmTriggerEvents(j);
      if (events && events.length) { eventSkipped++; continue; }

      // Per-user (non-event) continuous journey → re-scan segment, board NEW matches
      // at the start. _gtmFanout is idempotent (ON CONFLICT DO NOTHING), so this only
      // adds users who aren't already on the belt / haven't already run.
      const n = await JourneyService._gtmFanout(j);
      perUserJourneys++;
      added += (n || 0);
      if (n) console.log(`[ContinuousReEnroll] journey=${j.journey_id} "${j.name}" → +${n} new entries boarded at start`);
    } catch (e) {
      errors++;
      console.error(`[ContinuousReEnroll] journey=${j.journey_id} "${j.name}" failed: ${e.message}`);
    }
  }

  console.log(`[ContinuousReEnroll] done — per-user journeys re-scanned=${perUserJourneys}, new entries=${added}, event journeys skipped=${eventSkipped}, errors=${errors}`);
  return { perUserJourneys, added, eventSkipped, errors };
}

export default { runDailyContinuousReEnroll };
