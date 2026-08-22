---
id: 24
status: todo
model: opus
depends_on: [23]
max_attempts: 3
files:
  - web/lib/auth.ts
  - web/lib/auth.test.ts
  - web/proxy.ts
  - web/app/login/page.tsx
  - web/app/login/actions.ts
  - web/app/logout/route.ts
  - web/components/sidebar.tsx
  - web/app/layout.tsx
---
## Goal
Every page except `/login`, `/signup`, `/convite/*` requires a logged-in user; login with email+password works; sidebar shows the user's name + empresa and a "Sair" link.

## Context
Next 16.3 app router, no auth libs — use Node `crypto` only (no new dependencies). DB pool: `import { pool } from "@/lib/db"`. Tables from `migrations/007_tenant.sql` (ticket 23): `usuario(id, empresa_id, email, senha_hash, nome, role, ...)`, `sessao(token_hash, usuario_id, expira_em)`, `empresa(id, razao_social, nome_fantasia, cnpj)`. Types from `@/lib/tenant-types`.

`web/lib/auth.ts` (server-only; add `import "server-only"` is NOT available without the package — just never import from client components):
- `hashPassword(pw): Promise<string>` → `scrypt$<saltHex>$<hashHex>` using `crypto.scrypt(pw, salt, 64)` with 16-byte random salt; `verifyPassword(pw, stored): Promise<boolean>` with `timingSafeEqual`.
- `createSession(usuarioId): Promise<string>` → 32 random bytes base64url token; insert `sessao(token_hash=sha256hex(token), expira_em=now()+30 days)`; return raw token.
- `SESSION_COOKIE = "plic_session"`; `setSessionCookie(token)` / `clearSessionCookie()` via `cookies()` from `next/headers`: `httpOnly, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30d`.
- `getSession(): Promise<Session | null>` where `Session = { usuario: { id, nome, email, role, empresaId }, empresa: { id, razaoSocial, nomeFantasia, cnpj } }` — reads cookie, joins `sessao→usuario→empresa`, returns null if missing/expired.
- `requireSession(): Promise<Session>` — `redirect("/login")` if null. `requireAdmin(): Promise<Session>` — `requireSession()` then `redirect("/empresa")` if role !== 'admin'.
- `destroySession()` — delete row by cookie token hash, clear cookie.
- `login(email, password): Promise<Session | null>` — lowercase email, fetch user, reject if `senha_hash` null, verify, create session + cookie.

`web/lib/auth.test.ts`: `hashPassword`/`verifyPassword` round-trip, wrong password false, tampered hash false, two hashes of same pw differ (salt). Pure, no DB.

`web/proxy.ts` (Next 16 name for middleware; export `proxy` function + `config.matcher`): if path starts with `/login`, `/signup`, `/convite`, `/_next`, `/favicon.ico` → `NextResponse.next()`. Else if cookie `plic_session` absent → redirect to `/login?next=<pathname>`. Cookie presence only — DB validation happens in `requireSession()` in pages/actions. Matcher: `["/((?!_next/static|_next/image|favicon.ico).*)"]`.

`web/app/login/page.tsx`: server component, centered card (`max-w-sm mx-auto mt-24 rounded-lg border border-border bg-card p-8 shadow-subtle`), title "Entrar" (`font-display text-2xl font-bold`), form with `email`, `senha`, hidden `next`, submit button (primary style from `docs/WEB_STYLE.md`), link "Criar conta" → `/signup`. Show error from `?erro=1` ("E-mail ou senha inválidos."). This page must render WITHOUT the sidebar: in `web/app/layout.tsx` keep everything, but make `Sidebar` receive `session` prop (`await getSession()` in the async root layout) and render `null` when session is null — also drop the `max-w-5xl` wrapper padding? No: keep wrapper; login card centers inside it.

`web/app/login/actions.ts`: `"use server"` `loginAction(formData)` → `login()`; on success `redirect(next starting with "/" ? next : "/")`, else `redirect("/login?erro=1")`.

`web/app/logout/route.ts`: `POST` → `destroySession()` → redirect `/login`. Also accept `GET` for simplicity.

`web/components/sidebar.tsx`: stays `"use client"`; add prop `session: { nome: string; empresa: string; role: string } | null`. Add nav items `{ href: "/empresa", label: "Minha empresa" }`, and when `role === "admin"`: `/empresa/usuarios` "Usuários", `/empresa/documentos` "Documentos" under a second eyebrow "Empresa". `isActive`: `/empresa` exact, others prefix. Replace bottom paragraph with block: empresa name (`text-sm font-medium`), user name (`text-xs text-muted-foreground`), `<form action="/logout" method="post"><button>Sair</button></form>`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run lib/auth.test.ts`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3100/licitacoes)" = "307" && curl -s localhost:3100/login | grep -q "Entrar" && pkill -f "next-server"`

## Done when
- Unauthenticated `/licitacoes` → 307 to `/login`; `/login` renders without sidebar; with a manually inserted user (`psql`: insert empresa + usuario with hash produced by `hashPassword` via `node -e`), login sets cookie and `/` shows sidebar with name + "Sair"; Sair clears session.

## Not included
- No signup, no invite, no password reset, no rate limiting, no CSRF token beyond SameSite=Lax, no `/empresa*` pages (links may 404 until later tickets).
