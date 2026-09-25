---
id: 181
status: done
model: haiku
depends_on: [174, 175, 176, 177, 178, 179, 180]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - CLAUDE.md
  - STATE.md
  - web/.env.example
  - .env.example
---
## Goal
Env vars, CLI, architecture notes, CLAUDE.md map and STATE.md describe cycle 31 exactly as built; graph refreshed.

## Context
New env vars (all optional, defaults in code): `LIXTO_WEB_CACHE_TTL_SECONDS` (900; 175), `LIXTO_WEB_CACHE_MAX_ENTRIES` (500; 175), `LIXTO_WEB_EMBED_CACHE_SIZE` (500; 177), `LIXTO_PG_POOL_MAX` (10; 174), `LIXTO_PG_STATEMENT_TIMEOUT_MS` (60000; 174) — all read by `web` only. New route `POST /api/internal/cache/revalidate` (`{tags?}` → `{revalidated, dropped}`; tags `sync`, `match`). New CLI `lixto cache revalidate [--tag …]`; `lixto sync incremental` now ends with a best-effort revalidate call (warning only). Cache module `web/lib/cache.ts` (in-process, tags, TTL, single-flight). What is memoised: dashboard aggregates (`stats-queries.ts`, tag `sync`), `/procurements` facets + modality options (tag `sync`), digest last-match-run (tag `match`, dropped by the match route), search-text embeddings (`embed.ts`, process LRU). `getSession` memoised per request with React `cache` (ADR 003 §D3 unchanged). Query fixes: match candidate FTS `id IN (… UNION …)` + semantic CTE scoped to allowed portals and open/upcoming; Radar FTS without `coalesce`; Radar upsert `IS DISTINCT FROM`. Profile save skips the embed when `embedding_text` is unchanged. Post-deploy verification (success demo) is manual: read-only prod EXPLAIN via `ssh plugu-prod01 'docker exec -i <pg-shared container> psql -U shared -d lixto -X'` with `SET default_transaction_read_only=on; SET statement_timeout='60s';`, plus one sync run showing `cache: revalidated sync`.

### Work
1. `README.md`: Environment Variables table — add the five vars with purpose + default; CLI reference — add `uv run lixto cache revalidate` (one line) and a sentence on the sync's trailing revalidate; "Production Schedules" `sync-incremental` row — append "(ends with a `cache/revalidate` call to lixto-web)". Do not change cron expressions.
2. `docs/ARCHITECTURE.md`: new section `## Caching (Cycle 31)` after "Web app interaction model (Cycle 27)": what is cached, tags, invalidation path (sync → CLI → route), TTL fallback, what is deliberately not cached (per-company lists, session, detail), the session memo, and the query-shape rule ("FTS expressions textually identical to their index"). Add the five vars to "Configuration → Key Environment Variables". In "Testing & Quality" nothing changes.
3. `CLAUDE.md`: Environment Variables table — add the five vars; Key Code Locations — add `| Web cache | web/lib/cache.ts (tags sync/match), route web/app/api/internal/cache/revalidate, CLI src/lixto/cli/cache.py |`; schedules list — note the trailing revalidate on `sync-incremental`.
4. `web/.env.example` and root `.env.example`: add the five vars (web file) with one-line comments; root file gets none unless the CLI reads one (it does not).
5. `STATE.md`: rewrite (≤30 lines, never append): Now = cycle 31 (cache + query hygiene, mvp) 174–181 done, awaiting approval 2 of 2 + deploy; Next = commit + push (autoDeploy builds web + cli), then the manual success-demo verification above, then pg-shared Step B (still pending, needs Dokploy limit raise); carry over the still-open items from the current STATE.md (167 minus the `cache()` item now done, 162 follow-ups, DMARC, CNAE cleanup, Gemini billing, Radar + analyze-run OFF, `plugu-clientes-db-1`); Decisions = in-process memo not `unstable_cache`, tags `sync`/`match`, TTL 900 s, revalidate is best-effort in sync, statement_timeout 60 s.
6. `graphify update .` (AST-only).

## Checks (run in order — cheapest first)
1. `grep -q 'LIXTO_WEB_CACHE_TTL_SECONDS' README.md && grep -q 'LIXTO_PG_STATEMENT_TIMEOUT_MS' README.md && grep -q 'lixto cache revalidate' README.md`
2. `grep -q 'Caching (Cycle 31)' docs/ARCHITECTURE.md && grep -q 'web/lib/cache.ts' CLAUDE.md && grep -q 'LIXTO_WEB_EMBED_CACHE_SIZE' web/.env.example`
3. `test "$(wc -l < STATE.md)" -le 30 && grep -q 'Cycle 31' STATE.md`
4. `graphify update . > /dev/null && test -f graphify-out/GRAPH_REPORT.md`
5. `cd web && npm run lint && npx tsc --noEmit`

## Done when
- All checks green and every statement matches the code shipped in 174–180 (no planned-but-unbuilt behaviour described as built).

## Not included
- ADRs; any code change; Dokploy edits; running the prod verification itself.
