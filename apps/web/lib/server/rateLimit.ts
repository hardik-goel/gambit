/**
 * A small fixed-window limiter. Enough to stop a stuck client hammering a
 * table; production adds an edge-level limit in front of it.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Keeps the map from growing without bound on a long-lived server. */
export function sweepRateLimits(now = Date.now()): void {
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}
