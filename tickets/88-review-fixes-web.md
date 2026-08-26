---
id: 88
status: doing
model: sonnet
depends_on: [86]
max_attempts: 4
files:
  - web/app/(app)/procurement/[sourceId]/page.tsx
  - web/app/(app)/dashboard/page.tsx
  - web/lib/agent/embed.ts
  - web/lib/agent/embed.test.ts
  - web/lib/company-queries.ts
  - web/lib/company-queries.test.ts
  - web/app/(app)/company/actions.ts
  - web/lib/uploads.test.ts
  - web/app/(app)/signup/actions.ts
  - web/lib/signup-queries.ts
  - web/lib/signup-queries.test.ts
---
## Goal
Fix the reviewer's web findings: session enforcement on two pages, embedding-dimension guard, CNAE padding consistency, size validation, upload-path tests, duplicate-CNAE handling.

## Context
Reviewer pass over cycle 18 (verified; lines approximate):
6. `app/(app)/procurement/[sourceId]/page.tsx:34` and `app/(app)/dashboard/page.tsx` major — no `requireSession()`; `proxy.ts` only checks cookie presence, so a bogus cookie reads data and triggers the `enqueueMissingResults` write. Call `requireSession()` at the top of both pages (same as `/procurements`).
7. `lib/agent/embed.ts:72` major — `embedText` never checks `vector.length === EMBED_DIMS`; return `null` (+ `console.warn`) otherwise so `upsertProfile` stays best-effort. Test it.
11. `lib/company-queries.ts:152` major — CNAE codes written via `onlyDigits(code)` unpadded while `signup-queries.ts:105` pads to 7; a re-saved CNAE becomes space-padded `CHAR(7)` and never joins `procurement_cnaes`. Normalize identically (single helper `normalizeCnaeCode` exported from `company-queries.ts`, used by signup too). Tests for both paths.
15. `app/(app)/company/actions.ts:75` minor — validate `size` against `COMPANY_SIZES` before update (as signup does); invalid → `{ error }`.
16. `lib/uploads.ts:76` minor — add `web/lib/uploads.test.ts` covering `resolveUpload` with `../`, absolute path, and a valid relative path.
17. `app/(app)/signup/actions.ts:190` minor — dedupe CNAEs by code before insert; map a `23505` on the `company_cnaes` constraint to "CNAE duplicado" instead of "CNPJ ou e-mail já cadastrado" (branch on `err.constraint`).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. `cd web && (npm run start -- -p 3101 &) && sleep 5 && curl -s -o /dev/null -w '%{http_code}\n' -b "lixto_session=bogus" localhost:3101/dashboard` prints `307` (redirect to /login) — then `pkill -f next-server`.

## Done when
- Bogus cookie → redirect on `/dashboard` and `/procurement/[sourceId]`; embeddings with wrong dims are dropped, profile still saves; CNAE codes stored identically from signup and profile edit.

## Not included
- Python (87), env/docs (89).
