---
id: 163
status: done
model: sonnet
depends_on: []
max_attempts: 4
files:
  - web/lib/safe-next.ts
  - web/lib/safe-next.test.ts
  - web/lib/public-pages.ts
  - web/lib/public-pages.test.ts
  - web/app/(app)/login/page.tsx
  - web/app/(app)/login/actions.ts
  - web/app/(app)/signup/page.tsx
  - web/app/(app)/signup/recebido/page.tsx
---
## Goal
A visitor with a **valid** session who opens `/login`, `/signup` or `/signup/recebido` is redirected into the app instead of seeing the form wrapped in their own sidebar. Every other cookie state renders exactly as today, with no redirect loop.

## Context
`web/app/(app)/layout.tsx` renders `Sidebar`/`TopBar` whenever `getSession()` returns a session; the three pages above never look at the session, so a logged-in visitor gets the form inside the chrome. `web/proxy.ts` only checks cookie *presence* and must not change: a stale cookie is common, so the decision has to come from `getSession()` (`web/lib/auth.ts:193`, validates token hash, expiry and `approval_status='approved'` in one query). That is what prevents a `/login` ↔ `/dashboard` loop.

Work:
1. `web/lib/safe-next.ts` (pure, no imports): `export function safeNextPath(raw: string | null | undefined): string | null`. Returns `raw` only when it starts with `/` and its second character is neither `/` nor `\` (browsers normalise `/\evil.com` to `//evil.com`), and it contains no `\r`, `\n` or `\t`; else `null`. `export const DEFAULT_LANDING = "/dashboard"`.
2. `web/lib/public-pages.ts` (server-only module; imports `getSession` from `./auth`, `redirect` from `next/navigation`, `safeNextPath`/`DEFAULT_LANDING`):
   - `export async function getOptionalSession(): Promise<Session | null>` — `try { return await getSession(); } catch (err) { console.error("[public-pages] session lookup failed; treating as logged out", err); return null; }`. A DB outage must never 500 a public page. Do NOT swallow Next's control-flow errors: `getSession` does not call `redirect`/`notFound`, so a plain try/catch is safe here; say so in a comment.
   - `export async function redirectIfLoggedIn(next?: string): Promise<void>` — `const session = await getOptionalSession(); if (session) redirect(safeNextPath(next) ?? DEFAULT_LANDING);`. The `redirect()` call must sit **outside** any try/catch (it throws `NEXT_REDIRECT`).
3. `login/page.tsx`: first statement after resolving `searchParams` is `await redirectIfLoggedIn(first(params.next));` (so `?error=` never blocks it). Replace the inline `nextParam.startsWith(...)` expression with `safeNextPath(nextParam) ?? ""`.
4. `login/actions.ts`: replace both inline `next.startsWith("/")` checks with `safeNextPath(next)` (error round-trip sets `next` only when non-null; success target is `safeNextPath(next) ?? DEFAULT_LANDING`). Behaviour identical except `/\host` is now rejected.
5. `signup/page.tsx` and `signup/recebido/page.tsx`: make the component `async`, first line `await redirectIfLoggedIn();`. No other markup change.
6. Tests (vitest runs in node, no jsdom; do NOT import the `.tsx` pages — they pull `next/font`). Mocking pattern: `web/app/(app)/admin/companies/actions.test.ts` (`vi.mock("@/lib/auth", ...)` hoisted above imports; `next/navigation` `redirect` mocked to `throw new Error("REDIRECT:" + url)`).
   - `safe-next.test.ts`: accepts `/radar`, `/procurements?status=open&page=2`, `/`; rejects `""`, `undefined`, `null`, `radar`, `//evil.com`, `/\evil.com`, `https://evil.com`, `/a\nb`.
   - `public-pages.test.ts`: session + no next → redirect `/dashboard`; session + `/radar` → `/radar`; session + `//evil.com` → `/dashboard`; `getSession` resolves `null` (covers absent, empty, unknown, expired, pending/rejected cookie states — all surface as `null`) → `redirect` never called and the promise resolves; `getSession` rejects (DB down) → `getOptionalSession` resolves `null`, `redirectIfLoggedIn` does not throw, `redirect` not called.

Runtime probe preconditions: dev DB `docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml up -d db` (port 5433); dev server on :3000 (`cd web && npm run dev` in the background if `curl -s localhost:3000/login` fails). Cookie `lixto_session=devprobe` is a valid session (user 1, approved company 1).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/safe-next.test.ts lib/public-pages.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -b lixto_session=devprobe localhost:3000/login | grep -Eq '^307 http://localhost:3000/dashboard$'`
7. `curl -s -o /dev/null -w '%{redirect_url}' -b lixto_session=devprobe 'localhost:3000/login?next=/radar&error=invalid' | grep -q '/radar$' && curl -s -o /dev/null -w '%{redirect_url}' -b lixto_session=devprobe 'localhost:3000/login?next=//evil.com' | grep -q '/dashboard$'`
8. `for p in signup signup/recebido; do curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/$p | grep -qx 307 || exit 1; done`
9. `for c in '' '-b lixto_session=' '-b lixto_session=garbage'; do out=$(curl -s -w '\n%{http_code}' $c localhost:3000/login); echo "$out" | tail -1 | grep -qx 200 || exit 1; echo "$out" | grep -q 'Acesse sua conta' || exit 1; echo "$out" | grep -q 'Licitações' && exit 1; done; true`

## Done when
- All nine checks green.

## Not included
- Any change to `web/proxy.ts`, `web/app/(app)/layout.tsx`, `/invite/[token]`, `/email/unsubscribe`, `/logout`.
- Moving auth pages out of the `(app)` route group; restyling; account switching.
- Wrapping `getSession` in React `cache()` (the extra lookup on these three pages is accepted).
- The marketing header (164).
