import db from '../src/config/database.js';
await db.query(`SET statement_timeout=120000`);
const J=332, W='15';
// LIVE ground truth per node
console.log('=== LIVE (email_send_log, ground truth) ===');
const live = await db.query(`
  SELECT node_id,
    COUNT(*) FILTER (WHERE status NOT IN ('failed','queued')) sent,
    COUNT(DISTINCT unified_id) FILTER (WHERE opened_at IS NOT NULL) opened,
    COUNT(DISTINCT unified_id) FILTER (WHERE clicked_at IS NOT NULL) clicked,
    COUNT(DISTINCT unified_id) FILTER (WHERE opened_at IS NOT NULL AND sent_at IS NOT NULL AND opened_at-sent_at>=($2||' seconds')::interval) human_opened,
    COUNT(DISTINCT unified_id) FILTER (WHERE clicked_at IS NOT NULL AND sent_at IS NOT NULL AND clicked_at-sent_at>=($2||' seconds')::interval) human_clicked
  FROM email_send_log WHERE journey_id=$1 AND node_id IS NOT NULL GROUP BY node_id ORDER BY node_id`,[J,W]);
console.table(live.rows);

console.log('\n=== ROLLUP (journey_node_stats — what the UI shows) ===');
const roll = await db.query(`SELECT node_id, sent, opened, clicked, human_opened, human_clicked, computed_at FROM journey_node_stats WHERE journey_id=$1 AND node_id<>'__ALL__' ORDER BY node_id`,[J]);
console.table(roll.rows.map(r=>({node_id:r.node_id, sent:r.sent, opened:r.opened, clicked:r.clicked, human_opened:r.human_opened, human_clicked:r.human_clicked, as_of:new Date(r.computed_at).toISOString().slice(5,16).replace('T',' ')})));
process.exit(0);
