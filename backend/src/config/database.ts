import pg from 'pg';
import type { Pool as PgPool, PoolClient, QueryResult, QueryResultRow } from 'pg';

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

let _pool: PgPool | null = null;

/** pg.Pool marks `ending` publicly; `_ending` is the internal flag read here. */
type PoolWithEnding = PgPool & { _ending?: boolean };

function getPool(): PgPool {
  // Recreate if never created, or if pool.end() was called (sets _ending = true)
  if (!_pool || (_pool as PoolWithEnding)._ending) {
    console.warn('[DB] Creating new connection pool...');
    _pool = new Pool(CONFIG);
    _pool.on('error', (err: Error) => console.error('[DB] Unexpected pool error:', err));
  }
  return _pool;
}

/** Run a query, auto-healing if the pool was ended */
export async function query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
  const start = Date.now();
  const result = await getPool().query<R>(text, params);
  const duration = Date.now() - start;
  if (duration > 500) console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 100));
  return result;
}

/** Transaction helper: fn receives a client */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
const pool = new Proxy({} as PgPool, {
  get(_, prop: string | symbol) {
    const p = getPool();
    const val: unknown = p[prop as keyof PgPool];
    return typeof val === 'function' ? val.bind(p) : val;
  },
});

export default pool;
