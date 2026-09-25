// In-process tagged memo (PRODUCT cycle 31): single Node process, one
// replica, no Redis — an in-memory cache is exact and a deploy clears it.
// Global aggregates that only change when `sync-incremental` runs are
// memoised under tag "sync"; the dashboard/digest read of the last global
// match run is memoised under tag "match", dropped by the match batch route
// itself. See PRODUCT.md.
//
// No Next/React imports on purpose: this is plain TS, importable from lib
// tests (vitest, no path alias) and from anything else in `web/`.

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_MAX_ENTRIES = 500;

/** Known invalidation tags. `sync` is dropped by the CLI at the end of every
 * sync run (and by the manual `/api/internal/cache/revalidate` trigger);
 * `match` is dropped by the match batch route after each run. */
export const CACHE_TAGS = { sync: "sync", match: "match" } as const;
export type CacheTagName = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type Entry<T> = {
  value: T;
  expiresAt: number;
  tags: readonly string[];
};

type InFlight<T> = {
  promise: Promise<T>;
  tags: readonly string[];
};

type CacheOptions = {
  tags: readonly string[];
  ttlMs?: number;
};

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, InFlight<unknown>>();

/** Parses a positive integer from env, falling back to `fallback` for
 * anything non-finite or <= 0 — never throws at import time. */
function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Read at call time (not cached at module load) so tests can set the env
 * var and see it take effect without a module reset. */
function defaultTtlMs(): number {
  return envInt("LIXTO_WEB_CACHE_TTL_SECONDS", DEFAULT_TTL_SECONDS) * 1000;
}

function maxEntries(): number {
  return envInt("LIXTO_WEB_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES);
}

/** FIFO eviction: only fires when `key` is genuinely new and the store is at
 * its bound — refreshing an existing key never evicts. Map iteration order
 * is insertion order, so the first key is the oldest. */
function insert<T>(key: string, entry: Entry<T>): void {
  if (!store.has(key) && store.size >= maxEntries()) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, entry as Entry<unknown>);
}

/**
 * Hit → the stored value, while `expiresAt > Date.now()`. Miss → single
 * flight: concurrent callers of the same `key` share one in-flight `load()`
 * call. A rejected `load` is never stored and its rejection propagates to
 * every waiting caller.
 */
export async function cached<T>(
  key: string,
  opts: CacheOptions,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending.promise as Promise<T>;
  }

  // `record` is the identity token: `invalidateTags` may drop this in-flight
  // load while it is still running (the sync just rewrote the tables), and a
  // load that started before the write may resolve with pre-sync data. Only
  // the record that is still registered under `key` is allowed to store its
  // value; a superseded one returns it to its callers without caching.
  const record: InFlight<T> = { promise: undefined as unknown as Promise<T>, tags: opts.tags };
  record.promise = load().then(
    (value) => {
      if (inFlight.get(key) === record) {
        inFlight.delete(key);
        insert(key, {
          value,
          expiresAt: Date.now() + (opts.ttlMs ?? defaultTtlMs()),
          tags: opts.tags,
        });
      }
      return value;
    },
    (err) => {
      if (inFlight.get(key) === record) inFlight.delete(key);
      throw err;
    },
  );

  inFlight.set(key, record as InFlight<unknown>);
  return record.promise;
}

/** Drops every stored entry and in-flight load carrying any of `tags`.
 * Returns the number of entries dropped (stored + in-flight). */
export function invalidateTags(tags: readonly string[]): number {
  const tagSet = new Set(tags);
  let dropped = 0;

  for (const [key, entry] of store) {
    if (entry.tags.some((tag) => tagSet.has(tag))) {
      store.delete(key);
      dropped += 1;
    }
  }

  for (const [key, entry] of inFlight) {
    if (entry.tags.some((tag) => tagSet.has(tag))) {
      inFlight.delete(key);
      dropped += 1;
    }
  }

  return dropped;
}

/** Deterministic JSON of `parts`, with object keys sorted recursively so
 * `{a:1,b:2}` and `{b:2,a:1}` produce the same key. Used as a cache key
 * builder for compound filter objects. */
export function stableKey(parts: unknown): string {
  return JSON.stringify(sortForKey(parts));
}

function sortForKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForKey);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortForKey(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Test-only: clears every stored entry and in-flight load. */
export function resetCache(): void {
  store.clear();
  inFlight.clear();
}
