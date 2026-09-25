---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Cache and query hygiene on the hot paths (cycle 31)

## What / why
`web/` has zero caching. Global aggregates identical for every user (dashboard KPIs, `/procurements` facets, modality options) are recomputed by parallel seq scans on every page view, though the data only changes when `sync-incremental` runs (3×/day). One page view saturates the 4 cores of `plugu-prod01` (load avg 5.8 on 2026-09-21). The session query runs 2–3× per request, paging a semantic search re-embeds `q`, and two batch queries defeat their own indexes.

Repo facts that shape the cycle:
- **Single Node process**, one replica, no Redis: in-process caches are exact; a deploy clears them.
- **Invalidation source of truth is the sync.** `lixto sync incremental` already POSTs to `/api/internal/*` with `LIXTO_INTERNAL_TOKEN`. A new `POST /api/internal/cache/revalidate` drops the `sync` tag; the CLI hits it at the end of every sync run (also on partial failure); `lixto cache revalidate` is the manual trigger. TTL fallback (env, default 15 min) covers a sync that dies before the call.
- **Cache is an in-process memo** (`web/lib/cache.ts`: key + tags + TTL, single-flight on concurrent misses, bounded entries), not Next's `unstable_cache`: in Next 16 `revalidateTag` is stale-while-revalidate and `unstable_cache` is deprecated for `"use cache"`, out of scope.
- **Request scope**: `getSession` (`web/lib/auth.ts`) wrapped in `React.cache()`. ADR 003 §D3 holds: approval status is still re-read once per request; server actions are their own request.
- **Global aggregates** memoised under tag `sync`: `fetchModalityOptions` (also gains the `ACTIVE_PORTALS` filter), the 5 facet queries keyed on the full filter set, `fetchStatusCounts`, `fetchByDay`, `fetchByModality`/`fetchByPortal` per scope. The dashboard/digest read of the last global match run is memoised under tag `match`, dropped by the match batch route itself. Per-company queries, session, and detail pages stay uncached.
- **Query embedding**: in-process LRU `normalize(q) → pgvector literal` in `web/lib/agent/embed.ts` (bounded, env-sized). List rows and total come from one statement (`count(*) OVER ()`), so the semantic branch runs one HNSW scan per request instead of two.
- **Profile embedding**: `company/profile/actions.ts` skips `embedText` when the new `embedding_text` equals the stored one.
- **Query fixes that look like cache problems**: `match-queries.ts` OR-EXISTS FTS rewritten as `id IN (… UNION …)`; open/upcoming filter inside the semantic CTE of the match candidate query; Radar FTS drops `coalesce` so `idx_future_opportunities_title_fts` applies; Radar upsert guarded with `IS DISTINCT FROM`.
- **Pool**: `web/lib/db.ts` sets `max`, `statement_timeout`, `application_name` from env.
- **No schema change**, no new migration (ADR 001).

## Primary user story
As a logged-in operator, I open `/dashboard` and `/procurements`, page through a semantic search, and every view answers from cached aggregates plus my company's own rows — the database is not rescanned for numbers that only change when the sync runs, and the same search text is embedded once.

## Out of scope
- pg-shared Step B (raise the memory limit, `shared_buffers`); manual infra, separate runbook
- `"use cache"` / `cacheComponents` / PPR; Redis or any external cache
- Caching per-company lists (opportunities, cases, radar), sessions, or procurement detail
- `plan_item_embeddings` preservation by text hash on plan replace (Radar go-live cycle)
- Text-hash column on `procurement_embeddings`
- LLM prompt-cache instrumentation (`cached_tokens`), PDF byte storage, analysis re-run policy
- `matches` growth redesign; recommendation invalidation
- Any ranking or scoring change beyond restricting the semantic CTE to open/upcoming rows

## Success demo
Done when, on prod between two syncs, `/dashboard` and unfiltered `/procurements` hit Postgres only for the session (one query) and per-company rows, paging a search with `q` makes no new embeddings call, the sync run ends with a `cache/revalidate` call that refreshes the facets, and `EXPLAIN` on the match and Radar FTS predicates shows index scans.
