---
id: 175
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/lib/cache.ts
  - web/lib/cache.test.ts
  - web/app/api/internal/cache/revalidate/route.ts
  - web/app/api/internal/cache/revalidate/route.test.ts
  - web/lib/stats-queries.ts
  - web/lib/stats-queries.test.ts
  - web/lib/digest-queries.ts
  - web/lib/digest-queries.test.ts
  - web/app/api/internal/match/run/route.ts
  - web/app/api/internal/match/run/route.test.ts
---
## Goal
An in-process tagged memo, an internal route that drops a tag, and the dashboard's four global aggregates plus the digest's "last match run" read served from it — so `/dashboard` between two syncs runs no aggregate SQL.

## Context
No caching exists in `web/` (PRODUCT.md). Single Node process (`output: standalone`, one replica), no Redis. Aggregates that only change when `sync-incremental` runs: `fetchStatusCounts`, `fetchByDay`, `fetchByModality(scope)`, `fetchByPortal(scope)` in `web/lib/stats-queries.ts` (scope ∈ `open|upcoming|all`, so 3×2 result sets; all use `ACTIVE_PORTALS` as the only bind). The digest (`web/lib/digest-queries.ts:48`) calls `getLastRun("match")` from `opportunity-queries.ts`; that row changes only when the match batch runs, whose route is `web/app/api/internal/match/run/route.ts` (calls `runMatchBatch`). **Do not** memoise `getLastRun` itself: `match-batch.ts` uses it as the batch watermark and `match-batch.test.ts` mocks it. Internal routes follow `web/app/api/internal/match/run/route.ts` (token gate via `isInternalRequest` from `web/lib/internal-auth.ts`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, Portuguese error copy) and their tests follow `web/app/api/internal/cases/run/route.test.ts` (relative imports, `vi.mock` of the lib, `process.env.LIXTO_INTERNAL_TOKEN` set per test). Lib tests use relative imports (no `@/` alias in vitest). Next 16's `unstable_cache`/`revalidateTag` are out of scope (PRODUCT.md).

### Work
1. `web/lib/cache.ts` (new, no Next imports, pure TS):
   - `cached<T>(key: string, opts: { tags: readonly string[]; ttlMs?: number }, load: () => Promise<T>): Promise<T>`. Hit → stored value if `expiresAt > Date.now()`. Miss → single-flight: concurrent callers of the same key share one in-flight promise; a rejected `load` is not stored and the rejection propagates. Default TTL from `LIXTO_WEB_CACHE_TTL_SECONDS` (default `900`), read at call time so tests can set it. Bound: `LIXTO_WEB_CACHE_MAX_ENTRIES` (default `500`); when full, evict the oldest inserted entry (FIFO is enough).
   - `invalidateTags(tags: readonly string[]): number` — drops every entry carrying any of the tags (and any in-flight promise for those keys); returns the count dropped.
   - `stableKey(parts: unknown): string` — deterministic JSON with object keys sorted recursively (used by 177 for the filter object).
   - `resetCache(): void` for tests. Export the known tag names as `CACHE_TAGS = { sync: "sync", match: "match" } as const`.
2. `web/lib/cache.test.ts`: hit/miss, TTL expiry (use `vi.useFakeTimers`), single-flight (two concurrent calls → one `load`), rejected load not stored, tag invalidation drops only tagged entries, max-entries eviction, `stableKey` key-order independence.
3. `web/app/api/internal/cache/revalidate/route.ts`: `POST`, token-gated; body `{ tags?: string[] }`, default `["sync"]`; any tag not in `CACHE_TAGS` → 400 `{ error: "tag inválida" }`; on success `Response.json({ revalidated: tags, dropped })`. `route.test.ts`: 401 without token, default tags, explicit tags, unknown tag 400.
4. `web/lib/stats-queries.ts`: wrap the bodies of `fetchStatusCounts`, `fetchByDay`, `fetchByModality`, `fetchByPortal` in `cached(...)` with keys `stats:status`, `stats:by-day`, `stats:by-modality:${scope}`, `stats:by-portal:${scope}` and tag `sync`. SQL unchanged. Create `web/lib/stats-queries.test.ts`: mock `./db` `pool.query`; two calls → one query; after `invalidateTags(["sync"])` → second query. Note in a comment that `open/upcoming/new24h` drift with `now()` for at most one TTL — accepted (PRODUCT.md).
5. `web/lib/digest-queries.ts`: replace the direct `getLastRun("match")` with `cached("digest:last-match-run", { tags: ["match"] }, () => getLastRun("match"))`. Extend `digest-queries.test.ts` (it mocks `getLastRun`) with: two `getDigest` calls → `getLastRun` called once; `resetCache()` in `beforeEach`.
6. `web/app/api/internal/match/run/route.ts`: after `runMatchBatch` resolves, `invalidateTags([CACHE_TAGS.match])` before returning the JSON. Add/extend `route.test.ts` (create if missing, modelled on the cases route test) asserting the tag is dropped (mock `../../../../../lib/cache`).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/cache.test.ts lib/stats-queries.test.ts lib/digest-queries.test.ts app/api/internal/cache/revalidate/route.test.ts app/api/internal/match/run/route.test.ts`
4. `cd web && npx vitest run`

## Done when
- All checks green; `cache.ts` has no framework imports; the four stats functions and the digest's last-run read go through `cached`; the revalidate route rejects unknown tags; the match route drops the `match` tag after each batch.

## Not included
- `/procurements` wiring (ticket 177); CLI side (176); Next `unstable_cache`/`"use cache"`; any change to `getLastRun` in `opportunity-queries.ts` or to `match-batch.ts`; docs/env-example (181).
