/**
 * Live tail of the giveaway RabbitMQ stream — raw messages, straight off the broker.
 *
 *   npm run watch:giveaway   (tsx scripts/watch-giveaway.ts)
 *
 * Prints every message published to the `giveaways` exchange the instant it arrives,
 * with its full AMQP envelope and complete payload. Nothing is read from the database —
 * this is only what the producer actually sends.
 *
 * SAFE BY DESIGN — it does NOT consume the real queue. It binds its own exclusive,
 * auto-delete queue and receives COPIES, so the prod consumer still gets every message
 * and giveaway emails keep sending normally. Attaching a second consumer to
 * `giveaways.email.send` would round-robin and steal half of them; this never does that.
 * The tap queue is destroyed by the broker the moment this process exits.
 *
 * Bound with '#' (match-all), so it also catches routing keys that match NO binding —
 * messages the broker silently discards and which never reach the consumer at all.
 */
import 'dotenv/config';
import amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';

/** Only the field this tap reads; the full payload is printed verbatim. */
interface TappedPayload { type?: unknown }

const EXCHANGE = 'giveaways';
const QUEUE_BINDINGS = ['giveaway.email.*', 'giveaway.email.prod.*']; // what the real queue accepts
const VALID_TYPES = new Set<string>(['participation', 'eligible', 'winner', 'loser']);

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m', off: '\x1b[0m' };
const ts = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour12: false });
const rule = (s = ''): void => console.log(`${C.dim}${'─'.repeat(6)} ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}${C.off}`);

/** Would this routing key actually reach giveaways.email.send? ('*' = exactly one segment) */
function routable(rk: string): boolean {
  const seg = rk.split('.');
  return QUEUE_BINDINGS.some(b => {
    const bs = b.split('.');
    return bs.length === seg.length && bs.every((p, i) => p === '*' || p === seg[i]);
  });
}

const url = process.env.GIVEAWAY_RABBITMQ_URL;
if (!url) { console.error('GIVEAWAY_RABBITMQ_URL is not set in backend/.env'); process.exit(1); }

const conn = await amqp.connect(url, { clientProperties: { connection_name: 'rayna-watch-tap' } });
const ch = await conn.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true, durable: false });
await ch.bindQueue(queue, EXCHANGE, '#');

console.log(`${C.cyn}── giveaway RabbitMQ live watch ──${C.off}  Ctrl-C to stop`);
console.log(`${C.dim}exchange=${EXCHANGE}  binding=#  tap=${queue}${C.off}`);
console.log(`${C.dim}read-only: copies only — the prod consumer still receives every message${C.off}`);
console.log(`${C.dim}waiting for messages…${C.off}`);

let n = 0;
await ch.consume(queue, (msg: ConsumeMessage | null) => {
  if (!msg) return;
  n++;
  const rk = msg.fields.routingKey;
  const raw = msg.content.toString();
  let payload: TappedPayload | null = null;
  try { payload = JSON.parse(raw) as TappedPayload; } catch { /* keep raw text */ }
  const type = String(payload?.type ?? '(unparseable)');

  console.log('');
  rule(`#${n}  ${ts()}`);
  console.log(`${C.grn}routingKey${C.off} ${rk}`);
  console.log(`${C.grn}type      ${C.off} ${type}`);
  console.log(`${C.grn}envelope  ${C.off} exchange=${msg.fields.exchange} redelivered=${msg.fields.redelivered} bytes=${msg.content.length}` +
              (msg.properties?.contentType ? ` contentType=${msg.properties.contentType}` : ''));

  // Flag the two ways a message never becomes an email
  if (!routable(rk))            console.log(`${C.red}  ✗ routing key matches NO binding → broker DISCARDS it (consumer never sees it)${C.off}`);
  if (!VALID_TYPES.has(type))   console.log(`${C.red}  ✗ type not in VALID_TYPES → consumer acks and DROPS it as bad_type${C.off}`);
  if (routable(rk) && VALID_TYPES.has(type)) console.log(`${C.dim}  ✓ routable + valid type → consumer will process it${C.off}`);

  rule(payload ? 'payload (JSON)' : 'payload (RAW — not valid JSON)');
  console.log(payload ? JSON.stringify(payload, null, 2) : raw);
}, { noAck: true });   // noAck: nothing to ack — these are throwaway copies on a throwaway queue

const shutdown = async (): Promise<void> => {
  console.log(`\n${C.dim}stopping — ${n} message(s) captured. Tap queue auto-deleted.${C.off}`);
  try { await ch.close(); await conn.close(); } catch { /* already gone */ }
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
