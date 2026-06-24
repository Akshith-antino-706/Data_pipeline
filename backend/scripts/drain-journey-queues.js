import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const conn = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const names = ['journey-email', 'journey-wa', 'journey-sms'];
const queues = names.map(n => new Queue(n, { connection: conn }));

const before = await Promise.all(queues.map(q =>
  q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused')
));
console.log('BEFORE:');
names.forEach((n, i) => console.log(`  ${n}:`, before[i]));

for (const q of queues) {
  await q.drain(true);
}

const after = await Promise.all(queues.map(q =>
  q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused')
));
console.log('AFTER:');
names.forEach((n, i) => console.log(`  ${n}:`, after[i]));

await Promise.all(queues.map(q => q.close()));
await conn.quit();
