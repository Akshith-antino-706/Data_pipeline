import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const conn = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const action = (process.argv[2] || 'pause').toLowerCase(); // pause | resume | status
const names  = ['journey-email', 'journey-wa', 'journey-sms', 'welcome-email', 'gtm-journey'];
const queues = names.map(n => new Queue(n, { connection: conn }));

async function counts(q) {
  return q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
}

if (action === 'resume') {
  for (const q of queues) await q.resume();
  console.log('RESUMED all queues.');
} else if (action === 'status') {
  // no-op below; just print counts
} else {
  for (const q of queues) await q.pause();
  console.log('PAUSED all queues. (Jobs stay queued, worker stops consuming.)');
}

console.log('Current counts:');
for (let i = 0; i < queues.length; i++) {
  const c = await counts(queues[i]);
  const isPaused = await queues[i].isPaused();
  console.log(`  ${names[i]} [${isPaused ? 'PAUSED' : 'active'}]`, c);
}

await Promise.all(queues.map(q => q.close()));
await conn.quit();
