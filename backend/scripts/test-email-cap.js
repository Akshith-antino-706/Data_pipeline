// Standalone test for the email frequency cap — hits local Redis only, no DB, no emails.
// Run: EMAIL_CAP_ENABLED=true EMAIL_CAP_PER_24H=3 REDIS_URL=redis://127.0.0.1:6379 node scripts/test-email-cap.js
import IORedis from 'ioredis';
import { reserveSend, releaseSend, capLimit } from '../src/utils/emailFrequencyCap.js';

const r = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const id = `TESTCAP${Date.now()}`;
const key = `cap:u:${id}`;
const otherKey = `cap:u:${id}_b`;
let pass = 0, fail = 0;
const check = (label, cond) => { cond ? (pass++, console.log(`  ✓ ${label}`)) : (fail++, console.log(`  ✗ ${label}`)); };

async function main() {
  console.log(`Cap limit = ${capLimit()} / window\n`);
  await r.del(key, otherKey);

  console.log('Test 1 — first N allowed, then blocked:');
  const res = [];
  for (let i = 1; i <= 5; i++) res.push((await reserveSend({ unifiedId: id })).allowed);
  check('attempts 1-3 allowed', res[0] && res[1] && res[2]);
  check('attempt 4 blocked', res[3] === false);
  check('attempt 5 blocked', res[4] === false);

  const ttl = await r.ttl(key);
  console.log(`\nTest 2 — TTL set on first send:`);
  check(`TTL ~24h (got ${ttl}s)`, ttl > 86000 && ttl <= 86400);

  console.log('\nTest 3 — releaseSend frees a slot (failed send):');
  await r.del(key);
  await reserveSend({ unifiedId: id });               // 1
  await reserveSend({ unifiedId: id });               // 2
  const third = await reserveSend({ unifiedId: id });  // 3 (allowed)
  await releaseSend({ unifiedId: id });                // 3rd "failed" -> back to 2
  const reused = await reserveSend({ unifiedId: id });  // -> 3 again, allowed
  check('3rd allowed', third.allowed === true);
  check('after release, next still allowed (slot reused)', reused.allowed === true);
  check('4th now blocked', (await reserveSend({ unifiedId: id })).allowed === false);

  console.log('\nTest 4 — different recipient is independent:');
  check('other id allowed', (await reserveSend({ unifiedId: `${id}_b` })).allowed === true);

  console.log('\nTest 5 — email fallback key when no unifiedId:');
  const em = `capt${Date.now()}@example.com`;
  const a = await reserveSend({ email: em });
  const exists = await r.exists(`cap:e:${em}`);
  check('cap:e:<email> key created', exists === 1 && a.allowed === true);
  await r.del(`cap:e:${em}`);

  await r.del(key, otherKey);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await r.quit();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
