---
id: 166
status: done
model: sonnet
depends_on: [165]
max_attempts: 4
files:
  - web/lib/public-pages.ts
  - web/lib/public-pages.test.ts
  - web/lib/safe-next.ts
  - web/lib/safe-next.test.ts
  - web/app/(app)/login/actions.test.ts
  - docs/ARCHITECTURE.md
---
## Goal
Close the cycle-29 reviewer's pre-ship findings: stop `getOptionalSession` swallowing Next's control-flow errors, test the post-login redirect, and harden + fully test `safeNextPath`.

## Context
Reviewer pass over the uncommitted cycle-29 diff (single round). Suites are green today (`npm test` 763); keep them green.

Work (F = reviewer finding):
1. **(F1)** `web/lib/public-pages.ts` `getOptionalSession`: the bare `catch` also swallows Next's dynamic-rendering signals. `getSession()` → `cookies()` throws `DynamicServerError` during the prerender pass of `next build` (and a postpone signal under PPR); today that is logged as a bogus "session lookup failed" on every build and would prerender a logged-out shell if PPR/cacheComponents were enabled. Fix: `import { redirect, unstable_rethrow } from "next/navigation";` and make the catch body start with `unstable_rethrow(err);` (rethrows every Next internal control-flow error: redirect, notFound, DynamicServerError, bailout, postpone) before logging and returning `null`. Rewrite the doc comment: the current one claims control-flow errors cannot reach the catch — that is wrong; say what `unstable_rethrow` is for.
2. `public-pages.test.ts`: the `next/navigation` mock must now also export `unstable_rethrow`. Add cases: (a) a plain `Error("db down")` → `unstable_rethrow` mock is called with it, result `null`; (b) when the `unstable_rethrow` mock throws (simulating a control-flow error), `getOptionalSession` rejects with that same error and `console.error` is not called. Silence/spy `console.error` with `vi.spyOn(console, "error").mockImplementation(() => {})`.
3. **(F6)** `web/lib/safe-next.ts`: after the existing checks, take the pathname = `raw` up to the first `?` or `#`; return `null` when it is exactly `/login` or `/logout`, or is `/signup` or starts with `/signup/`. Reason (put it in the comment): these are public-only or side-effecting targets — `next=/login?next=…` nests one redirect hop per level, `next=/logout` turns a crafted login link into a logout. Keep the function pure and import-free.
4. **(F7)** `safe-next.test.ts` add explicit cases: reject `/a\rb`, `/\t/evil.com`, `/login`, `/login?next=/logout`, `/logout`, `/signup`, `/signup/recebido`, `/logout#x`; accept `/%5Cevil.com` (stays same-origin — comment why), `/loginx`, `/signups`, `/radar?next=/login`.
5. **(F3)** new `web/app/(app)/login/actions.test.ts`. Pattern: `web/app/(app)/admin/companies/actions.test.ts`. `vi.mock("@/lib/auth", () => ({ login: vi.fn() }))`; `vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error("REDIRECT:" + url); }) }))`. Cases (FormData with `email`, `password`, `next`): `{status:"ok"}` + `/radar` → `REDIRECT:/radar`; ok + `//evil.com` → `/dashboard`; ok + `/\evil.com` → `/dashboard`; ok + no `next` → `/dashboard`; ok + `/logout` → `/dashboard`; `{status:"invalid"}` + `/radar` → `/login?error=invalid&next=%2Fradar`; invalid + `//evil.com` → exactly `/login?error=invalid`; `{status:"pending"}` → `/login?error=pending`. Do not edit `actions.ts`; if a case fails because of `actions.ts`, stop and report.
6. `docs/ARCHITECTURE.md` "Session-aware public pages" paragraph: extend the `safeNextPath` parenthesis with "and public-only/side-effecting targets (`/login`, `/signup*`, `/logout`)"; add one sentence: "`getOptionalSession` rethrows Next control-flow errors via `unstable_rethrow` before treating a failure as logged out."

Runtime preconditions: `next dev` from this repo is already on :3000, DB on :5433, cookie `lixto_session=devprobe` valid. Do not start or kill servers.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/safe-next.test.ts lib/public-pages.test.ts 'app/(app)/login/actions.test.ts'`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && out=$(npm run build 2>&1); rc=$?; test $rc -eq 0 && ! echo "$out" | grep -q 'session lookup failed'`
6. `curl -s -o /dev/null -w '%{redirect_url}' -b lixto_session=devprobe 'localhost:3000/login?next=/logout' | grep -q '/dashboard$' && curl -s -o /dev/null -w '%{redirect_url}' -b lixto_session=devprobe 'localhost:3000/login?next=/login%3Fnext%3D/radar' | grep -q '/dashboard$' && curl -s -o /dev/null -w '%{redirect_url}' -b lixto_session=devprobe 'localhost:3000/login?next=/radar&error=invalid' | grep -q '/radar$'`
7. `for c in '' '-b lixto_session=devprobe' '-b lixto_session=garbage'; do curl -s -o /dev/null -w '%{http_code}' $c localhost:3000/ | grep -qx 200 || exit 1; done`

## Done when
- All seven checks green.

## Not included
- Static shell / Suspense for `/`, `Vary: Cookie`, React `cache()` around `getSession` (ticket 167).
- Any edit to `login/actions.ts`, `login/page.tsx`, `proxy.ts`, the marketing components.
