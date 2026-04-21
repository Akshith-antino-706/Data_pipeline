/**
 * End-to-end Journey module test. Exercises:
 *   - Journey create + node CRUD via API
 *   - audience + track column persistence
 *   - processJourney track-aware advancement (Indian vs Rest)
 *   - WhatsApp → Rest auto-pair swap (channel becomes restChannel, template becomes restTemplateId)
 *   - Conversion detection: new booking AND segment change
 *   - Real SMTP email delivery through a journey action (ONLY to akshith@antino.com)
 *   - journey_events audit trail (action_sent / converted / simulated)
 *
 * IMPORTANT: Real SMTP delivery happens for akshith@antino.com ONLY. Other test users
 * (anket, vaibhav, alok) are exercised through non-email channels (WhatsApp + SMS) so no
 * actual messages go out to their inboxes — their routing is verified via journey_events.
 *
 * Run with: node scripts/e2e_journey_test.js
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import JourneyService from '../src/services/JourneyService.js';

const BASE = 'http://localhost:3001';
const TEST_USER_ID = 1369472;  // akshith@antino.com — the ONLY user allowed to receive real email

function log(label, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`  ${icon} [${status}] ${label}${detail ? ' — ' + detail : ''}`);
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const results = { pass: 0, fail: 0, warn: 0 };
const record = (status) => { results[status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'warn']++; };

async function section(title) { console.log('\n━━━ ' + title + ' ━━━'); }

// ── TEST 1: Schema integrity ──────────────────────────────────
async function testSchema() {
  await section('1. Schema integrity');

  const cols = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='journey_flows' AND column_name IN ('audience','conversion_event','stop_on_conversion')
  `);
  const hasAudience = cols.rows.some(r => r.column_name === 'audience');
  log('journey_flows.audience column', hasAudience ? 'PASS' : 'FAIL');
  record(hasAudience ? 'PASS' : 'FAIL');

  const entryCols = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='journey_entries' AND column_name IN ('track','converted_at','last_conversion_check')
  `);
  const expected = ['track', 'converted_at', 'last_conversion_check'];
  const missing = expected.filter(c => !entryCols.rows.some(r => r.column_name === c));
  log('journey_entries.{track,converted_at,last_conversion_check}', missing.length === 0 ? 'PASS' : 'FAIL',
      missing.length ? 'missing: ' + missing.join(',') : '');
  record(missing.length === 0 ? 'PASS' : 'FAIL');
}

// ── TEST 2: Journey CRUD ──────────────────────────────────────
let testJourneyId;
async function testCRUD() {
  await section('2. Journey + Node CRUD');

  const created = await api('/api/v3/journeys', {
    method: 'POST',
    body: JSON.stringify({
      name: 'E2E Test Journey — Delete Me',
      description: 'Automated test',
      audience: 'all',
      status: 'draft',
      nodes: [{ id: 'trigger_1', type: 'trigger', data: { label: 'Entry' } }],
      edges: [],
    }),
  });
  testJourneyId = created.json?.data?.journey_id;
  log('POST /journeys creates flow', testJourneyId ? 'PASS' : 'FAIL', testJourneyId ? `id=${testJourneyId}` : JSON.stringify(created.json));
  record(testJourneyId ? 'PASS' : 'FAIL');
  if (!testJourneyId) return;

  const addIN = await api(`/api/v3/journeys/${testJourneyId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      node: { type: 'action', data: { label: 'Day 1 WA', channel: 'whatsapp', track: 'indian', templateId: null, restChannel: 'sms', restTemplateId: null } },
      afterNodeId: 'trigger_1',
    }),
  });
  const indianNodeId = addIN.json?.data?.nodes?.slice(-1)[0]?.id;
  log('POST /nodes adds Indian WhatsApp node', indianNodeId ? 'PASS' : 'FAIL', indianNodeId || JSON.stringify(addIN.json));
  record(indianNodeId ? 'PASS' : 'FAIL');

  const addROW = await api(`/api/v3/journeys/${testJourneyId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      node: { type: 'action', data: { label: 'Day 1 SMS ROW', channel: 'sms', track: 'rest' } },
      afterNodeId: 'trigger_1',
    }),
  });
  const restNodeId = addROW.json?.data?.nodes?.slice(-1)[0]?.id;
  log('POST /nodes adds Rest SMS node', restNodeId ? 'PASS' : 'FAIL');
  record(restNodeId ? 'PASS' : 'FAIL');

  const patched = await api(`/api/v3/journeys/${testJourneyId}/nodes/${indianNodeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { label: 'Updated label', templateId: 568 } }),
  });
  const patchedNode = patched.json?.data?.nodes?.find(n => n.id === indianNodeId);
  const patchedOk = patchedNode?.data?.label === 'Updated label'
    && patchedNode?.data?.templateId === 568
    && patchedNode?.data?.channel === 'whatsapp';  // preserved
  log('PATCH /nodes/:id merges data (label+templateId, preserves channel)', patchedOk ? 'PASS' : 'FAIL');
  record(patchedOk ? 'PASS' : 'FAIL');

  const deleted = await api(`/api/v3/journeys/${testJourneyId}/nodes/${restNodeId}`, { method: 'DELETE' });
  const stillThere = deleted.json?.data?.nodes?.some(n => n.id === restNodeId);
  log('DELETE /nodes/:id removes node', !stillThere ? 'PASS' : 'FAIL');
  record(!stillThere ? 'PASS' : 'FAIL');

  const listed = await api('/api/v3/journeys?audience=all&limit=5');
  const hasAudienceField = listed.json?.data?.[0] && 'audience' in listed.json.data[0];
  log('GET /journeys?audience= returns audience field', hasAudienceField ? 'PASS' : 'FAIL');
  record(hasAudienceField ? 'PASS' : 'FAIL');
}

// ── TEST 3: Enrollment track routing ─────────────────────────
async function testEnrollment() {
  await section('3. Enrollment → track stamped from is_indian');

  const { rows: testUsers } = await db.query(`
    SELECT unified_id, name, email, is_indian
    FROM unified_contacts
    WHERE unified_id IN (1369472, 90551, 1811248, 1811249)
    ORDER BY unified_id
  `);
  log('4 test users exist in unified_contacts', testUsers.length === 4 ? 'PASS' : 'WARN', `found ${testUsers.length}`);
  record(testUsers.length === 4 ? 'PASS' : 'WARN');

  for (const u of testUsers) {
    await db.query(
      `INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track, status)
       VALUES ($1, $2, 'trigger_1', $3, 'active')
       ON CONFLICT (journey_id, customer_id) DO UPDATE SET
         track = EXCLUDED.track, status = 'active', current_node_id = 'trigger_1', converted_at = NULL, exit_reason = NULL`,
      [testJourneyId, u.unified_id, u.is_indian ? 'indian' : 'rest']
    );
  }

  const { rows: entries } = await db.query(`
    SELECT je.customer_id, je.track, uc.is_indian
    FROM journey_entries je JOIN unified_contacts uc ON uc.unified_id = je.customer_id
    WHERE je.journey_id = $1
  `, [testJourneyId]);

  const wrong = entries.filter(e => (e.is_indian && e.track !== 'indian') || (!e.is_indian && e.track !== 'rest'));
  log('Every entry\'s track matches unified_contacts.is_indian', wrong.length === 0 ? 'PASS' : 'FAIL',
      wrong.length ? `${wrong.length} mismatches` : `${entries.length}/${entries.length} correct`);
  record(wrong.length === 0 ? 'PASS' : 'FAIL');
}

// ── TEST 4: processJourney track routing + auto-pair (NO real emails for non-akshith) ──
async function testProcess() {
  await section('4. processJourney: track routing + WhatsApp auto-pair (no real email for non-akshith)');

  // Flow: trigger → wa_step (whatsapp for Indian, auto-pair to SMS for Rest — both are NOT
  // delivered for real since WA + SMS providers aren't wired) → end.
  // This isolates ROUTING metadata from SMTP delivery, so anket/vaibhav/alok don't get real emails.
  await db.query('UPDATE journey_flows SET nodes = $2, edges = $3 WHERE journey_id = $1', [
    testJourneyId,
    JSON.stringify([
      { id: 'trigger_1', type: 'trigger', data: { label: 'Entry' } },
      { id: 'wa_step',   type: 'action',  data: { label: 'WA step', channel: 'whatsapp', track: 'all', templateId: 568, restChannel: 'sms', restTemplateId: 568 } },
    ]),
    JSON.stringify([{ id: 'e1', source: 'trigger_1', target: 'wa_step' }]),
  ]);

  await db.query(`UPDATE journey_entries SET current_node_id='trigger_1', status='active', converted_at=NULL, exit_reason=NULL WHERE journey_id=$1`, [testJourneyId]);

  // Advance everyone trigger_1 → wa_step
  const r1 = await JourneyService.processJourney(testJourneyId);
  log('Pass 1: advance past trigger', r1.processed > 0 ? 'PASS' : 'FAIL', JSON.stringify(r1));
  record(r1.processed > 0 ? 'PASS' : 'FAIL');

  // Fire the action (WhatsApp for Indian, auto-pair to SMS for Rest — neither sends anything live)
  const r2 = await JourneyService.processJourney(testJourneyId);
  log('Pass 2: action fires on wa_step', r2.actioned > 0 ? 'PASS' : 'FAIL', JSON.stringify(r2));
  record(r2.actioned > 0 ? 'PASS' : 'FAIL');

  const { rows: events } = await db.query(`
    SELECT ent.customer_id, ent.track, je.channel, je.details
    FROM journey_events je
    JOIN journey_entries ent ON ent.entry_id = je.entry_id
    WHERE ent.journey_id = $1 AND je.node_id = 'wa_step' AND je.event_type = 'action_sent'
    ORDER BY je.created_at DESC
  `, [testJourneyId]);

  const indianEvents = events.filter(e => e.track === 'indian');
  const restEvents   = events.filter(e => e.track === 'rest');

  const indianOk = indianEvents.length > 0 && indianEvents.every(e => e.channel === 'whatsapp' && !e.details?.autoPaired);
  log('Indian entries: channel=whatsapp, autoPaired=false', indianOk ? 'PASS' : 'FAIL',
      `${indianEvents.length} events, channels=${[...new Set(indianEvents.map(e => e.channel))].join(',')}`);
  record(indianOk ? 'PASS' : 'FAIL');

  const restOk = restEvents.length > 0 && restEvents.every(e => e.channel === 'sms' && e.details?.autoPaired === true && e.details?.originalChannel === 'whatsapp');
  log('Rest entries: channel=sms (auto-paired from whatsapp), autoPaired=true', restOk ? 'PASS' : 'FAIL',
      `${restEvents.length} events, channels=${[...new Set(restEvents.map(e => e.channel))].join(',')}`);
  record(restOk ? 'PASS' : 'FAIL');
}

// ── TEST 5: Real email delivery to akshith only ──────────────
async function testRealEmail() {
  await section('5. Real SMTP delivery (akshith@antino.com ONLY)');

  // Reset flow: trigger → shared email action. DELETE non-akshith entries so only he is processed.
  await db.query('UPDATE journey_flows SET nodes = $2, edges = $3 WHERE journey_id = $1', [
    testJourneyId,
    JSON.stringify([
      { id: 'trigger_1', type: 'trigger', data: { label: 'Entry' } },
      { id: 'email_step', type: 'action', data: { label: 'Real email test', channel: 'email', track: 'all', templateId: 568 } },
    ]),
    JSON.stringify([{ id: 'e1', source: 'trigger_1', target: 'email_step' }]),
  ]);
  await db.query(`DELETE FROM journey_entries WHERE journey_id=$1 AND customer_id <> $2`, [testJourneyId, TEST_USER_ID]);
  await db.query(`UPDATE journey_entries SET current_node_id='trigger_1', status='active', converted_at=NULL, exit_reason=NULL WHERE journey_id=$1`, [testJourneyId]);

  const { rows: [remaining] } = await db.query('SELECT COUNT(*)::int AS n FROM journey_entries WHERE journey_id=$1', [testJourneyId]);
  log(`Only 1 entry remains (akshith)`, remaining.n === 1 ? 'PASS' : 'FAIL', `n=${remaining.n}`);
  record(remaining.n === 1 ? 'PASS' : 'FAIL');

  // Advance past trigger
  await JourneyService.processJourney(testJourneyId);
  // Fire email action — real SMTP send to akshith@antino.com
  const r = await JourneyService.processJourney(testJourneyId);
  log('Pass fires action node', r.actioned === 1 ? 'PASS' : 'FAIL', JSON.stringify(r));
  record(r.actioned === 1 ? 'PASS' : 'FAIL');

  const { rows: [evt] } = await db.query(`
    SELECT je.channel, je.details, ent.customer_id
    FROM journey_events je JOIN journey_entries ent ON ent.entry_id = je.entry_id
    WHERE ent.journey_id=$1 AND je.node_id='email_step' AND je.event_type='action_sent'
    ORDER BY je.created_at DESC LIMIT 1
  `, [testJourneyId]);

  const sendOk = evt?.details?.sendResult?.success === true;
  log('SMTP send succeeded', sendOk ? 'PASS' : 'FAIL', evt ? `customer=${evt.customer_id}, channel=${evt.channel}, result=${JSON.stringify(evt.details?.sendResult)}` : 'no event');
  record(sendOk ? 'PASS' : 'FAIL');

  const providerOk = evt?.details?.sendResult?.provider === 'smtp';
  log('Provider is smtp (real delivery, not simulated)', providerOk ? 'PASS' : 'FAIL', evt?.details?.sendResult?.provider || 'none');
  record(providerOk ? 'PASS' : 'FAIL');
}

// ── TEST 6: Conversion — booking OR segment change ──────────
async function testConversion() {
  await section('6. Conversion check (booking + segment change)');

  const { rows: [testEntry] } = await db.query(
    `SELECT entry_id, entered_at FROM journey_entries WHERE journey_id=$1 AND customer_id=$2 LIMIT 1`,
    [testJourneyId, TEST_USER_ID]
  );
  if (!testEntry) { log('Entry for test user exists', 'FAIL'); record('FAIL'); return; }

  // Seed a synthetic tour booking AFTER entered_at so conversion check picks it up
  const seededBillno = `E2E_TEST_${Date.now()}`;
  await db.query(`UPDATE journey_entries SET entered_at = NOW() - INTERVAL '1 day', status='active', converted_at=NULL, exit_reason=NULL WHERE entry_id=$1`, [testEntry.entry_id]);
  await db.query(
    `INSERT INTO rayna_tours (billno, bill_date, unified_id, guest_name, tours_name, total_sell)
     VALUES ($1, NOW(), $2, 'E2E Test', 'Test Tour', 100.00)`,
    [seededBillno, TEST_USER_ID]
  );

  try {
    const { rows: [fullEntry] } = await db.query(`
      SELECT je.*, uc.segment_label AS current_segment, sd.segment_name AS journey_segment, uc.is_indian
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      LEFT JOIN segment_definitions sd ON sd.segment_id = (SELECT segment_id FROM journey_flows WHERE journey_id = je.journey_id)
      WHERE je.entry_id = $1
    `, [testEntry.entry_id]);

    const conv = await JourneyService.checkConversion(fullEntry);
    const bookingOk = conv.converted && conv.reason === 'booking';
    log('checkConversion detects new booking', bookingOk ? 'PASS' : 'FAIL', JSON.stringify(conv));
    record(bookingOk ? 'PASS' : 'FAIL');
  } finally {
    // intentionally leave seeded booking; cleanup at end
  }
  globalThis.__seededBillno = seededBillno;

  // Segment change branch — synthesize an entry with mismatched segment and non-existent customer (no bookings)
  const segOnlyEntry = { customer_id: -99999, entered_at: new Date(), journey_segment: 'PROSPECT', current_segment: 'PAST_BOOKING' };
  const segConv = await JourneyService.checkConversion(segOnlyEntry);
  const segOk = segConv.converted && segConv.reason === 'segment_change';
  log('checkConversion detects segment change', segOk ? 'PASS' : 'FAIL', JSON.stringify(segConv));
  record(segOk ? 'PASS' : 'FAIL');

  // Full loop: processJourney sees conversion and exits entry with status='converted'
  await db.query('UPDATE journey_flows SET nodes = $2, edges = $3 WHERE journey_id = $1', [
    testJourneyId,
    JSON.stringify([
      { id: 'trigger_1', type: 'trigger', data: {} },
      // A wait so we can verify pre-action conversion check fires before send
      { id: 'w1', type: 'wait', data: { waitDays: 0, track: 'all' } },
    ]),
    JSON.stringify([{ id: 'e', source: 'trigger_1', target: 'w1' }]),
  ]);
  await db.query(`UPDATE journey_entries SET current_node_id='w1', status='active', entered_at = NOW() - INTERVAL '5 years' WHERE entry_id=$1`, [testEntry.entry_id]);
  await JourneyService.processJourney(testJourneyId);
  const { rows: [after] } = await db.query('SELECT status, converted_at, exit_reason FROM journey_entries WHERE entry_id=$1', [testEntry.entry_id]);
  const processOk = after.status === 'converted' && after.converted_at && after.exit_reason;
  log('processJourney auto-exits converted entries', processOk ? 'PASS' : 'FAIL', JSON.stringify(after));
  record(processOk ? 'PASS' : 'FAIL');
}

// ── TEST 7: Edge stitching on deleteNode ─────────────────────
async function testEdgeStitching() {
  await section('7. deleteNode edge-stitching');
  await db.query('UPDATE journey_flows SET nodes=$2, edges=$3 WHERE journey_id=$1', [
    testJourneyId,
    JSON.stringify([
      { id: 'A', type: 'trigger', data: {} },
      { id: 'B', type: 'action', data: { channel: 'email', track: 'all' } },
      { id: 'C', type: 'action', data: { channel: 'email', track: 'all' } },
    ]),
    JSON.stringify([
      { id: 'e_AB', source: 'A', target: 'B' },
      { id: 'e_BC', source: 'B', target: 'C' },
    ]),
  ]);
  await JourneyService.deleteNode(testJourneyId, 'B');
  const { rows: [j] } = await db.query('SELECT nodes, edges FROM journey_flows WHERE journey_id=$1', [testJourneyId]);
  const stitched = j.edges.some(e => e.source === 'A' && e.target === 'C');
  const Bgone = !j.nodes.some(n => n.id === 'B') && !j.edges.some(e => e.source === 'B' || e.target === 'B');
  log('A→C edge created after deleting B', stitched && Bgone ? 'PASS' : 'FAIL',
      `nodes=${j.nodes.length}, edges=${j.edges.length}`);
  record(stitched && Bgone ? 'PASS' : 'FAIL');
}

// ── Cleanup ──────────────────────────────────────────────────
async function cleanup() {
  await section('8. Cleanup');
  if (testJourneyId) {
    await db.query('DELETE FROM journey_flows WHERE journey_id = $1', [testJourneyId]);
    log(`Test journey ${testJourneyId} deleted`, 'PASS');
    record('PASS');
  }
  if (globalThis.__seededBillno) {
    await db.query('DELETE FROM rayna_tours WHERE billno = $1', [globalThis.__seededBillno]);
    log(`Seeded booking ${globalThis.__seededBillno} deleted`, 'PASS');
    record('PASS');
  }
}

(async () => {
  console.log('\n🧪 Journey Module E2E Test — ' + new Date().toISOString());
  console.log('    (real email delivery restricted to akshith@antino.com)\n');
  try {
    await testSchema();
    await testCRUD();
    await testEnrollment();
    await testProcess();
    await testRealEmail();
    await testConversion();
    await testEdgeStitching();
  } catch (err) {
    console.error('\n❌ UNCAUGHT:', err.stack);
    results.fail++;
  } finally {
    await cleanup();
  }
  console.log(`\n━━━ Summary ━━━\n  ✅ PASS ${results.pass}   ⚠️  WARN ${results.warn}   ❌ FAIL ${results.fail}\n`);
  process.exit(results.fail > 0 ? 1 : 0);
})();
