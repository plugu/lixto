---
id: 174
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/lib/auth.ts
  - web/lib/auth.test.ts
  - web/app/(app)/layout.tsx
  - web/lib/db.ts
---
## Goal
One session query per request instead of 2–3, and a pg pool that is sized, named and time-boxed from env.

## Context
`getSession()` (`web/lib/auth.ts:193-201`) reads the cookie and runs one query (`buildSessionByTokenQuery`). `requireSession`/`requireAdmin`/`requireSuperadmin` call it again, and every page under `(app)` calls one of them on top of the layout's own call (`web/app/(app)/layout.tsx:12`, whose comment "once here, per request" is currently false; `/admin/*` runs it 3×). ADR 003 §D3 requires the company approval status to be re-read on every request — request-scoped memoisation keeps that: `React.cache()` dedupes only within one server render, and each server action is its own request. `web/lib/db.ts` builds `new Pool({ connectionString })` with no `max`, no `statement_timeout`, no `application_name`; `@types/pg` `PoolConfig` accepts all three (`statement_timeout?: false | number`, `application_name?: string`).

### Work
1. `web/lib/auth.ts`: `import { cache } from "react"`; keep the existing async body as an inner function and export `getSession = cache(async function getSession() { … })` with the same signature and return type. Update the doc comment: memoised per request (React `cache`), still re-read on the next request (ADR 003 §D3). `requireSession`/`requireAdmin`/`requireSuperadmin` unchanged.
2. `web/lib/auth.test.ts`: add one test that `getSession` is the same function reference on repeated imports and that calling it twice inside one `cache` scope hits `pool.query` once — if the existing test file already mocks `pool` and `next/headers`, reuse that harness; otherwise assert only that `pool.query` is called once when the module-level `getSession` is invoked twice with the same mocked cookie (React `cache` outside a render falls back to the plain function, so in that case assert the mocked query was called twice and document why). Never delete the existing F3 approval re-check test.
3. `web/app/(app)/layout.tsx:10-12`: fix the comment — the cookie→DB lookup is memoised per request by `getSession`, so the page's `requireSession` reuses it.
4. `web/lib/db.ts`: read `LIXTO_PG_POOL_MAX` (default `10`), `LIXTO_PG_STATEMENT_TIMEOUT_MS` (default `60000`) and pass `max`, `statement_timeout`, `application_name: "lixto-web"` to `new Pool`. Parse with `Number(...)`; a non-finite or ≤0 value falls back to the default (no throw at import time). Keep the dev `globalThis.__lixtoPool` reuse.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/auth.test.ts`
4. `cd web && grep -q 'cache(' lib/auth.ts && grep -q 'statement_timeout' lib/db.ts && grep -q 'application_name' lib/db.ts`

## Done when
- All four checks green; `getSession` is wrapped in React `cache`; `db.ts` reads the two env vars with the stated defaults; no other behaviour change.

## Not included
- Cookie-stored session claims or any change to what the session query checks; `proxy.ts`; docs/README/env-example edits (ticket 181); any `Cache-Control` header work (carry-over 167 stays a carry-over).
