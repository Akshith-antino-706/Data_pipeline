// Remove one journey's PENDING jobs from the shared `journey-email` BullMQ queue,
// so other journeys behind it in the FIFO queue can be processed immediately.
//
// Context: all email journeys share the single `journey-email` queue. A huge
// backlog from one journey (e.g. J242) blocks smaller journeys (e.g. J245).
// Pause that journey first (journey_flows.status='paused') so the engine won't
// re-enqueue it, THEN run this to drop its already-queued jobs.
//
// SAFE: only removes waiting/delayed/paused jobs whose data.journeyId matches.
// Active (in-flight) jobs are left to finish. Dropped jobs for an ACTIVE journey
// would be re-enqueued by the engine within ~2 min; for a PAUSED journey they
// simply won't send until you resume it.
//
//   node scripts/clear-journey-queue.js                 # DRY RUN (counts only)
//   CONFIRM=true node scripts/clear-journey-queue.js    # actually remove
//   JOURNEY_ID=242 CHANNEL=email CONFIRM=true node scripts/clear-journey-queue.js
import { getQueue } from '../src/services/queue/index.js';

const JID     = parseInt(process.env.JOURNEY_ID || '242', 10);
const CHANNEL = process.env.CHANNEL || 'email';
const CONFIRM = process.env.CONFIRM === 'true';
const PAGE    = 500;

const q = getQueue(CHANNEL);
const counts = await q.getJobCounts('waiting', 'delayed', 'paused', 'active');
console.log(`queue "${CHANNEL}" counts:`, counts);
console.log(`target journey_id=${JID}  mode=${CONFIRM ? 'REMOVE' : 'DRY RUN'}\n`);

let cursor = 0, removed = 0, kept = 0, scannedPages = 0;
while (true) {
  const jobs = await q.getJobs(['waiting', 'delayed', 'paused'], cursor, cursor + PAGE - 1);
  if (!jobs.length) break;
  scannedPages++;
  for (const job of jobs) {
    if (!job) continue;
    if (Number(job.data?.journeyId) === JID) {
      if (CONFIRM) await job.remove();
      removed++;
    } else {
      kept++; cursor++;   // advance past jobs we keep so we don't re-scan them
    }
  }
  if (removed % 5000 === 0 && removed) console.log(`  … removed ${removed} so far (kept ${kept})`);
  // when a page had no removals and only kept jobs, we've moved the cursor past them; keep going
  if (jobs.length < PAGE && cursor >= counts.waiting + counts.delayed + counts.paused) break;
}

console.log(`\n${CONFIRM ? 'REMOVED' : 'WOULD REMOVE'} ${removed} J${JID} jobs from "${CHANNEL}" (kept ${kept} others).`);
const after = await q.getJobCounts('waiting', 'delayed', 'paused', 'active');
console.log('queue counts now:', after);
console.log(CONFIRM ? '\n✔ done — workers will now reach the remaining journeys.' : '\nDRY RUN — set CONFIRM=true to remove.');
process.exit(0);
