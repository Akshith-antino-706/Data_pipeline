/**
 * Live RabbitMQ tap — connects and prints every message as it arrives.
 *
 *   npm run watch:giveaway
 *
 * Read-only: it binds its OWN temporary queue with '#' (match-all) and reads copies, so the
 * real consumer still receives everything. The tap queue is deleted when this process exits.
 */
import 'dotenv/config';
import amqp from 'amqplib';

const EXCHANGE = 'giveaways';
const url = process.env.GIVEAWAY_RABBITMQ_URL;
if (!url) { console.error('GIVEAWAY_RABBITMQ_URL is not set in backend/.env'); process.exit(1); }

// heartbeat: without it an idle TLS connection is dropped and the process dies with ETIMEDOUT.
const conn = await amqp.connect(url, { heartbeat: 30, clientProperties: { connection_name: 'rayna-watch-tap' } });
conn.on('error', (e) => console.error(`connection error: ${e.message}`));
conn.on('close', () => { console.error('connection closed — exiting'); process.exit(1); });

const ch = await conn.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true, durable: false });
await ch.bindQueue(queue, EXCHANGE, '#');

console.log(`connected — exchange=${EXCHANGE}, waiting for messages… (Ctrl-C to stop)`);

let n = 0;
await ch.consume(queue, (msg) => {
  if (!msg) return;
  const raw = msg.content.toString();
  console.log(`\n──── #${++n}  ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })}  ${msg.fields.routingKey}`);
  try { console.log(JSON.stringify(JSON.parse(raw), null, 2)); }
  catch { console.log(raw); }
}, { noAck: true });

const shutdown = async () => {
  console.log(`\nstopping — ${n} message(s) captured.`);
  try { await ch.close(); await conn.close(); } catch { /* already gone */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
