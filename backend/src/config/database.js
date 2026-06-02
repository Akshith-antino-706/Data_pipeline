import pg from 'pg';

const { Pool } = pg;

const CONFIG = {
  host:                   process.env.DB_HOST || 'raynadb.cx2ygcy4akh9.eu-north-1.rds.amazonaws.com',
  port:                   parseInt(process.env.DB_PORT || '5432'),
  database:               process.env.DB_NAME || 'postgres',
  user:                   process.env.DB_USER || 'raynadb',
  password:               process.env.DB_PASS || 'raynadevdb',
  ssl:                    process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max:                    parseInt(process.env.DB_POOL_MAX || '60'),
  idleTimeoutMillis:      30000,
  connectionTimeoutMillis: 30000,
};

let _pool = null;

function getPool() {
  // Recreate if never created, or if pool.end() was called (sets _ending = true)
  if (!_pool || _pool._ending) {
    console.warn('[DB] Creating new connection pool...');
    _pool = new Pool(CONFIG);
    _pool.on('error', (err) => console.error('[DB] Unexpected pool error:', err));
  }
  return _pool;
}

/** Run a query, auto-healing if the pool was ended */
export async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 100));
  return result;
}

/** Transaction helper: fn receives a client */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Proxy export — every property access is forwarded to the current live pool.
 * If pool.end() was called (e.g. during a graceful-reload that didn't fully exit),
 * the next access recreates the pool transparently.
 */
const pool = new Proxy({}, {
  get(_, prop) {
    const p = getPool();
    const val = p[prop];
    return typeof val === 'function' ? val.bind(p) : val;
  },
});

export default pool;
