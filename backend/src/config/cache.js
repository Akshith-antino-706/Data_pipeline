import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const PREFIX = 'dp:';          // data-pipeline namespace
const DEFAULT_TTL = 3600;      // 1 hour

let _redis;
function getRedis() {
  if (!_redis) {
    _redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _redis.connect().catch(() => {
      console.warn('[Cache] Redis unavailable — running without cache');
      _redis = null;
    });
  }
  return _redis;
}

/**
 * Get cached value or compute & store it.
 * Falls back to computing without cache if Redis is down.
 */
export async function cached(key, computeFn, ttl = DEFAULT_TTL) {
  const redis = getRedis();
  if (!redis) return computeFn();

  const fullKey = PREFIX + key;
  try {
    const hit = await redis.get(fullKey);
    if (hit) return JSON.parse(hit);
  } catch { /* miss or parse error — compute fresh */ }

  const result = await computeFn();

  try {
    await redis.set(fullKey, JSON.stringify(result), 'EX', ttl);
  } catch { /* ignore write errors */ }

  return result;
}

/**
 * Delete exact cache keys (no KEYS scan — safe on a shared Redis).
 */
export async function del(...keys) {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys.map(k => PREFIX + k));
  } catch (err) {
    console.warn('[Cache] del error:', err.message);
  }
}

/**
 * Invalidate cached keys by pattern (e.g., 'dashboard:*')
 */
export async function invalidate(pattern) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const keys = await redis.keys(PREFIX + pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Invalidated ${keys.length} keys matching "${pattern}"`);
    }
  } catch (err) {
    console.warn('[Cache] Invalidation error:', err.message);
  }
}

/**
 * Flush all cached keys under the dp: namespace.
 * Called on server startup to ensure fresh data.
 */
export async function flushAll() {
  const redis = getRedis();
  if (!redis) return;

  try {
    const keys = await redis.keys(PREFIX + '*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] Startup flush — cleared ${keys.length} cached keys`);
    } else {
      console.log('[Cache] Startup flush — no cached keys to clear');
    }
  } catch (err) {
    console.warn('[Cache] Startup flush error:', err.message);
  }
}

export default { cached, del, invalidate, flushAll };
