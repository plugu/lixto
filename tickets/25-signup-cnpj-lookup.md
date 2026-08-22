---
id: 25
status: todo
model: sonnet
depends_on: [24]
max_attempts: 3
files:
  - web/lib/cnpj-lookup.ts
  - web/lib/cnpj-lookup.test.ts
  - web/lib/signup-queries.ts
  - web/lib/signup-queries.test.ts
  - web/app/signup/page.tsx
  - web/app/signup/actions.ts
  - web/components/signup-form.tsx
---
## Goal
`/signup`: user types CNPJ → form autofills from BrasilAPI → submits empresa + admin user in one transaction → logged in, redirected to `/empresa`.

## Context
Auth helpers in `@/lib/auth` (`hashPassword`, `createSession`, `setSessionCookie`). Validators in `@/lib/br-validators`. Types/consts in `@/lib/tenant-types`. DB pool `@/lib/db`. Tables per `migrations/007_tenant.sql`.

`web/lib/cnpj-lookup.ts`:
- `lookupCNPJ(cnpjDigits, fetchImpl = fetch): Promise<CnpjLookup | null>` — GET `https://brasilapi.com.br/api/cnpj/v1/${cnpj}` with 6 s `AbortSignal.timeout`; on non-200/throw return `null` (manual fallback).
- Map to `CnpjLookup = { razaoSocial, nomeFantasia, naturezaJuridica, porte: Porte | null, optanteSimples, cep, logradouro, numero, complemento, bairro, municipio, uf, telefone, email, cnaes: {codigo, descricao, principal}[] }`. BrasilAPI fields: `razao_social`, `nome_fantasia`, `natureza_juridica` (join `codigo_natureza_juridica` + `natureza_juridica` as `"206-2 - Sociedade…"` — only the text field is guaranteed; use `natureza_juridica` as-is), `porte` ("MICRO EMPRESA"→`ME`, "EMPRESA DE PEQUENO PORTE"→`EPP`, "DEMAIS"→`MEDIO`, unknown→null; `MEI` when `opcao_pelo_mei === true`), `opcao_pelo_simples`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `uf`, `ddd_telefone_1` → telefone, `email`, `cnae_fiscal` + `cnae_fiscal_descricao` → principal, `cnaes_secundarios[{codigo, descricao}]` → secundários (codigo as 7-digit string, `String(codigo).padStart(7,"0")`).
- `web/lib/cnpj-lookup.test.ts`: mock fetch with a fixture JSON → mapped result; 404 → null; thrown → null; porte mapping table.

Lookup is exposed as a server action (no API route — `proxy.ts` blocks `/api/*` without a cookie and must not be edited here): `actions.ts` exports `lookupAction(cnpj: string): Promise<CnpjLookup | null>` (`"use server"`), validates `isValidCNPJ` (return null otherwise) then calls `lookupCNPJ`. The client form calls it directly.

`web/components/signup-form.tsx` (`"use client"`): steps in one form. Fields: CNPJ (masked on blur via `formatCNPJ`), button "Buscar dados" → calls `lookupAction`, fills all empresa fields (editable), CNAEs shown as list with checkbox "principal" (radio semantics, exactly one) and remove button; "Adicionar CNAE" row (codigo + descricao). Then usuário fields: nome, email, senha (min 8), confirmar senha, CPF (optional), telefone, cargo. Porte as `<select>` from `PORTES`; UF `<select>` from `UF_LIST`; optante Simples checkbox. Submit → `signupAction`. Show `erro` string returned from action inline. Style per `docs/WEB_STYLE.md` (controls, primary button, card). Labels pt-BR.

`web/app/signup/actions.ts`: `"use server"`; `signupAction(prev, formData)` (use `useActionState` in client) validates: CNPJ valid, razão social non-empty, email valid, senha ≥8 and equals confirmação, CPF valid if given, ≥1 CNAE with exactly one principal. Calls `createEmpresaComAdmin(input)` then `createSession` + `setSessionCookie` → `redirect("/empresa")`. On unique violation (`23505`) → "CNPJ ou e-mail já cadastrado."

`web/lib/signup-queries.ts`: `createEmpresaComAdmin(input): Promise<{ empresaId, usuarioId }>` — single `pool.connect()` client, `BEGIN` … insert empresa, insert cnaes (multi-row), insert usuario role `'admin'` with `senha_hash` … `COMMIT`, `ROLLBACK` on error, `release()` in finally. Export `buildInsertEmpresa(input)` / `buildInsertCnaes(empresaId, cnaes)` / `buildInsertUsuario(...)` returning `{ text, values }` so they're unit-testable (pattern from `web/lib/queries.ts`).
`web/lib/signup-queries.test.ts`: builders produce parameterized SQL, cnaes values flattened correctly, digits-only cnpj/cpf/cep, lowercased email.

`web/app/signup/page.tsx`: server component, title "Criar conta", renders `<SignupForm />`, link "Já tem conta? Entrar".

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run lib/cnpj-lookup.test.ts lib/signup-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/signup | grep -q "Criar conta" && pkill -f "next-server"`

## Done when
- Real CNPJ (e.g. `00.000.000/0001-91` Banco do Brasil) autofills; submit creates `empresa`, `empresa_cnae`, `usuario(role=admin)` rows; redirected to `/empresa` logged in; duplicate CNPJ shows error; BrasilAPI down → fields stay empty, manual submit still works.

## Not included
- No edit of `proxy.ts`, no `/empresa` page (ticket 26), no email verification, no captcha.
