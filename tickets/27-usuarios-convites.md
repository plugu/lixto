---
id: 27
status: todo
model: sonnet
depends_on: [24]
max_attempts: 3
files:
  - web/lib/usuario-queries.ts
  - web/lib/usuario-queries.test.ts
  - web/app/empresa/usuarios/page.tsx
  - web/app/empresa/usuarios/actions.ts
  - web/app/convite/[token]/page.tsx
  - web/app/convite/[token]/actions.ts
  - web/components/usuarios-table.tsx
  - web/components/convite-form.tsx
---
## Goal
Admin lists empresa users, invites by email (link shown on screen — no email sending), changes roles, removes users; invitee opens `/convite/<token>`, fills nome/senha, becomes `member` and is logged in.

## Context
Auth in `@/lib/auth`: `requireAdmin()`, `hashPassword`, `createSession`, `setSessionCookie`. `proxy.ts` already allows `/convite/*` unauthenticated. Schema `migrations/007_tenant.sql`: `usuario.convite_token_hash` (sha256 hex), `convite_expira_em`, `senha_hash NULL` while pending. Types `@/lib/tenant-types`; validators `@/lib/br-validators`; pool `@/lib/db`. Style `docs/WEB_STYLE.md` tables/badges/buttons. Tenant rule: `empresaId` only from session.

`web/lib/usuario-queries.ts`:
- `listUsuarios(empresaId): Promise<(Usuario & { pendente: boolean })[]>` — `pendente = senha_hash IS NULL`; order by nome.
- `createConvite(empresaId, { email, nome, role }): Promise<{ token }>` — token = 32 random bytes base64url; insert usuario with `convite_token_hash=sha256hex(token)`, `convite_expira_em=now()+7 days`, `senha_hash NULL`, email lowercased. Throw `"E-mail já cadastrado."` on `23505`.
- `getConvite(token): Promise<{ id, nome, email, empresaRazaoSocial } | null>` — join empresa; null if hash not found, expired, or `senha_hash` not null.
- `acceptConvite(token, { nome, senhaHash, cpf?, telefone?, cargo? }): Promise<{ usuarioId }>` — `UPDATE … SET senha_hash=$, nome=$, …, convite_token_hash=NULL, convite_expira_em=NULL WHERE convite_token_hash=$ AND convite_expira_em > now() AND senha_hash IS NULL RETURNING id`; null → throw "Convite inválido ou expirado."
- `updateRole(empresaId, usuarioId, role)`, `removeUsuario(empresaId, usuarioId)` — both `WHERE id=$ AND empresa_id=$`. Guard: caller cannot change/remove own row (check in action), and empresa must keep ≥1 admin (`SELECT count(*) … role='admin' AND id<>$` inside same transaction, throw "A empresa precisa de ao menos um administrador.").
- Builders exported for tests: `buildListUsuarios`, `buildUpdateRole`, `buildRemoveUsuario`, `buildAcceptConvite`; plus `hashToken(token)`.
- `web/lib/usuario-queries.test.ts`: every builder includes `empresa_id = $n` bound to empresaId (except accept, which binds token hash); `hashToken` is 64-hex; accept SQL includes `senha_hash IS NULL` and `convite_expira_em > now()`.

`web/app/empresa/usuarios/page.tsx`: `requireAdmin()`; title "Usuários"; `<ConviteForm/>` card (nome, email, role select admin/member, button "Gerar convite"); after action, show the invite URL `${origin}/convite/${token}` in a copyable `<input readOnly>` (origin from `headers().get("host")` + proto); `<UsuariosTable rows currentUserId/>`.

`web/components/usuarios-table.tsx`: columns Nome, E-mail, Cargo, Papel (badge admin/member), Status (badge "Pendente"/"Ativo"), Ações: role `<select>` that submits `updateRoleAction` on change, "Remover" button (form with `confirm` via `onSubmit` — note: uses window.confirm; acceptable) — both disabled for the current user's own row.

`web/app/empresa/usuarios/actions.ts`: `"use server"` `criarConviteAction(prev, fd)` (validate email/nome/role; returns `{ token }` or `{ erro }`), `updateRoleAction(fd)`, `removerUsuarioAction(fd)` — all `requireAdmin()`, `revalidatePath("/empresa/usuarios")`.

`web/app/convite/[token]/page.tsx`: `getConvite(token)`; null → card "Convite inválido ou expirado."; else card "Você foi convidado para **{razão social}**", form nome (prefilled), email (read-only), senha, confirmar, CPF (optional), telefone, cargo → `aceitarConviteAction`.
`web/app/convite/[token]/actions.ts`: validate (senha ≥8 + match, CPF valid if given) → `acceptConvite` → `createSession` + cookie → `redirect("/empresa")`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run lib/usuario-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/convite/naoexiste | grep -q "Convite inválido" && pkill -f "next-server"`

## Done when
- Admin generates invite, opens link in private window, sets password, lands on `/empresa` as member; member hitting `/empresa/usuarios` is redirected to `/empresa`; removing last admin is refused.

## Not included
- No email delivery, no resend/revoke UI (re-inviting same email = error), no password change for existing users.
