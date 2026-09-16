import 'dotenv/config';
import { Pool } from 'pg';

// Internal admin CLI only — takes a raw SQL WHERE fragment, not meant to be wired to any API/route.
//
// Usage:
//   node scripts/bulk_unsubscribe.js --where "<sql fragment referencing uc.*>" --channels email,whatsapp --reason "..." [--execute]
//
// Example:
//   node scripts/bulk_unsubscribe.js \
//     --where "EXISTS (SELECT 1 FROM chats c WHERE c.unified_id = uc.id AND c.receiver = '97142087112')" \
//     --channels email,whatsapp \
//     --reason "Agent Restricted" \
//     --execute

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function getArg(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const WHERE = getArg('--where');
const REASON = getArg('--reason');
const CHANNELS = (getArg('--channels') || '').split(',').map((c) => c.trim()).filter(Boolean);

const VALID_CHANNELS = ['email', 'whatsapp', 'sms', 'push_notification'];
// Only these two channels have a corresponding column on unified_contacts to actually flip.
const UNIFIED_CONTACTS_COLUMN = {
  email: 'email_unsubscribe',
  whatsapp: 'wa_unsubscribe',
};

if (!WHERE || !REASON || CHANNELS.length === 0) {
  console.error('Usage: node scripts/bulk_unsubscribe.js --where "<sql fragment on uc>" --channels email,whatsapp --reason "..." [--execute]');
  process.exit(1);
}
for (const c of CHANNELS) {
  if (!VALID_CHANNELS.includes(c)) {
    console.error(`Invalid channel "${c}". Valid channels: ${VALID_CHANNELS.join(', ')}`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const targetSql = `SELECT uc.id FROM unified_contacts uc WHERE ${WHERE}`;
  const targets = await pool.query(targetSql);
  const ids = targets.rows.map((r) => r.id);

  console.log(`Target contacts matching WHERE clause: ${ids.length}`);
  if (ids.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (const c of CHANNELS) {
    const col = UNIFIED_CONTACTS_COLUMN[c];
    if (col) {
      const already = await pool.query(
        `SELECT COUNT(*) FROM unified_contacts WHERE id = ANY($1::int[]) AND ${col} = 'Yes'`,
        [ids]
      );
      console.log(`Already ${col}='Yes': ${already.rows[0].count}`);
    } else {
      console.log(`Channel "${c}" has no corresponding unified_contacts column — only unsubscribe_reason will be written.`);
    }
  }
  console.log(`Reason to record: "${REASON}"`);
  console.log(`Channels: ${CHANNELS.join(', ')}`);

  if (!EXECUTE) {
    console.log('\nDry run only — no changes made. Re-run with --execute to apply.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setCols = CHANNELS.map((c) => UNIFIED_CONTACTS_COLUMN[c]).filter(Boolean);
    if (setCols.length > 0) {
      const setClause = setCols.map((col) => `${col} = 'Yes'`).join(', ');
      const updateResult = await client.query(
        `UPDATE unified_contacts SET ${setClause}, updated_at = NOW() WHERE id = ANY($1::int[])`,
        [ids]
      );
      console.log(`Updated unified_contacts rows: ${updateResult.rowCount}`);
    }

    const reasonCols = ['email', 'whatsapp', 'sms', 'push_notification'];
    const insertCols = reasonCols.map((c) => (CHANNELS.includes(c) ? '$2' : 'NULL'));
    const updateSet = reasonCols
      .filter((c) => CHANNELS.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const insertResult = await client.query(
      `INSERT INTO unsubscribe_reason (unified_id, email, whatsapp, sms, push_notification)
       SELECT unnest($1::int[]), ${insertCols.join(', ')}
       ON CONFLICT (unified_id) DO UPDATE SET ${updateSet}, updated_at = NOW()`,
      [ids, REASON]
    );
    console.log(`Upserted unsubscribe_reason rows: ${insertResult.rowCount}`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const reasonCount = await pool.query(
    `SELECT COUNT(*) FROM unsubscribe_reason WHERE unified_id = ANY($1::int[]) AND email = $2`,
    [ids, REASON]
  );
  console.log(`\nVerified: unsubscribe_reason rows with reason='${REASON}': ${reasonCount.rows[0].count}`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
