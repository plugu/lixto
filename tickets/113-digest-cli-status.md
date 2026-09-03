---
id: 113
status: todo
model: sonnet
depends_on: [108, 110, 111, 112]
max_attempts: 4
files:
  - web/lib/email/digest-batch.ts
  - web/lib/email/digest-batch.test.ts
  - web/app/api/internal/email/digest/route.ts
  - src/lixto/cli/email.py
  - src/lixto/internal_api.py
  - src/lixto/status.py
  - tests/test_cli_email.py
  - tests/test_status.py
---
## Goal
The daily digest gets enqueued per company, the CLI can trigger both email jobs, and `lixto status` shows the mail queue.

## Context

Cycle 19 pattern: batch logic lives in the web app behind a token-guarded internal route; the CLI is a thin trigger (`src/lixto/cli/match.py` + `InternalApi.match_run` in `src/lixto/internal_api.py`, `src/lixto/cli/__init__.py` auto-mounts a module exporting `name` + `app`).

1. **`web/lib/email/digest-batch.ts`** — `runDigestBatch({ companyId? })`: for every company that has at least one user with an email (or just the given one), call `getDigest(company.id)` (from `@/lib/digest-queries`); **skip when `attentionCount === 0 && matchedCount === 0`** (never send an empty digest); otherwise enqueue one `daily_digest` per admin user's email with `dedupeKey = "daily_digest:<companyId>:<YYYY-MM-DD>"` (idempotent per day), payload built from the `Digest` (map `attention` rows to the template's card shape, `url = ${APP_URL}/procurement/<sourceId>`, `unsubscribeUrl = buildUnsubscribeUrl(email)` from `@/lib/email/unsubscribe`). Returns `{ companies, enqueued, skipped }`.
2. **`POST /api/internal/email/digest`** — same guard/shape as `web/app/api/internal/email/send/route.ts`; optional `{ companyId }`; returns the counts.
3. **`src/lixto/cli/email.py`** — `name = "email"`, `app = typer.Typer(...)`, two commands mirroring `cli/match.py`: `worker` (`--limit`, default 20 → `POST /api/internal/email/send`) and `digest` (`--company-id` → `POST /api/internal/email/digest`), each printing the returned counts and exiting non-zero on `InternalApiError`. Add `email_send(limit)` and `email_digest(company_id)` to `InternalApi` next to `match_run`/`recommend_run`.
4. **`src/lixto/status.py`** — extend `StatusReport` with `email: dict[str, int]` (`queued`, `sent_24h`, `failed_24h`, `suppressed`) from one query over `email_messages`/`email_suppressions`, and append to `format_status`:
```
email:
  queued: <n>
  sent (24h): <n>
  failed (24h): <n>
  suppressed: <n>
```
Guard the query with a `to_regclass('email_messages') IS NOT NULL` check so `lixto status` still works on a database that predates migration 003 (report zeros).

Tests: `digest-batch.test.ts` (mock `getDigest` + `enqueue`) — company with zero counts is skipped; a company with attention enqueues one row per admin email with the dated dedupe key and ≤5 cards. `tests/test_cli_email.py` — mirrors `tests/test_cli_match_recommend.py` (mocked `InternalApi`): both commands call the right method and exit 1 on error. `tests/test_status.py` — add the email block assertions to the existing mocked-cursor suite.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint && npx tsc --noEmit`
2. `uv run ruff check src tests && uv run ruff format --check src tests`
3. `cd web && npx vitest run lib/email/digest-batch.test.ts`
4. `uv run pytest tests/test_cli_email.py tests/test_status.py -q`
5. `uv run pytest -q && cd web && npm test`

## Done when
- `runDigestBatch` skips zero-count companies and produces one dated, deduped row per admin email otherwise; `lixto email worker` / `lixto email digest` trigger the internal routes; `lixto status` prints the `email:` block (zeros on a pre-003 database).

## Not included
- Dokploy schedules (orchestrator), docs (ticket 114), password-reset flow.
