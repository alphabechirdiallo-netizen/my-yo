// In-memory cache for performance optimization
const cache = new Map();
const TTL = new Map();

export function setCache(key, value, ttlMs = 30000) {
  cache.set(key, value);
  TTL.set(key, Date.now() + ttlMs);
}

export function getCache(key) {
  const expiry = TTL.get(key);
  if (!expiry || Date.now() > expiry) {
    cache.delete(key);
    TTL.delete(key);
    return null;
  }
  return cache.get(key);
}

export function invalidateCache(key) {
  cache.delete(key);
  TTL.delete(key);
}

export function invalidatePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      TTL.delete(key);
    }
  }
}

// Cached fetch wrapper
export async function cachedFetch(key, fetchFn, ttlMs = 30000) {
  const cached = getCache(key);
  if (cached !== null) return cached;
  const result = await fetchFn();
  if (result !== null && result !== undefined) setCache(key, result, ttlMs);
  return result;
}
