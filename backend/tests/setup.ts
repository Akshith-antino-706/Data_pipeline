// Runs before every test file. Its job is to make it impossible for tests to reach a real
// database, Redis or message broker — even by accident.
//
// Why it matters: src/config/database.js falls back to the production RDS host when DB_HOST
// is unset. So every connection setting is forced to an unroutable local address here,
// before any application module is imported.

process.env.NODE_ENV = 'test';

const LOCAL = '127.0.0.1';
for (const k of ['DB_HOST', 'MYSQL_HOST', 'MYSQL2_HOST', 'DEV_DB_HOST']) process.env[k] = LOCAL;
process.env.DB_PORT = '1';          // nothing listens on port 1 → any query fails fast
process.env.DB_USER = 'test';
process.env.DB_PASS = 'test';
process.env.DB_NAME = 'test';
process.env.DB_SSL = 'false';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.GIVEAWAY_RABBITMQ_URL = '';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else-0123456789';
process.env.WELCOME_EMAILS = '';

// Belt and braces: refuse to run if anything still points at a production host.
const PROD_HINTS = ['rds.amazonaws.com', 'cloudamqp.com', 'raynatours.com'];
for (const [k, v] of Object.entries(process.env)) {
  if (/(_HOST|_URL)$/.test(k) && v && PROD_HINTS.some(h => String(v).includes(h))) {
    throw new Error(`[tests] Refusing to run: ${k} points at a production host`);
  }
}
