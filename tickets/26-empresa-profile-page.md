---
id: 26
status: done
model: sonnet
depends_on: [24]
max_attempts: 3
files:
  - web/lib/empresa-queries.ts
  - web/lib/empresa-queries.test.ts
  - web/app/empresa/page.tsx
  - web/app/empresa/actions.ts
  - web/components/empresa-form.tsx
  - web/components/cnae-editor.tsx
---
## Goal
`/empresa` shows the logged-in user's empresa (all fields + CNAEs); admins can edit everything and save; members see read-only.

## Context
`requireSession()` / `requireAdmin()` from `@/lib/auth` give `{ usuario: { id, role, empresaId }, empresa }`. Tenant rule: **every query takes `empresaId` from the session, never from form/URL.** Types in `@/lib/tenant-types`; validators in `@/lib/br-validators`; pool `@/lib/db`. Schema `migrations/007_tenant.sql`. Style `docs/WEB_STYLE.md` (cards, controls, primary button, pt-BR labels).

`web/lib/empresa-queries.ts`:
- `getEmpresa(empresaId): Promise<Empresa | null>`; `getCnaes(empresaId): Promise<EmpresaCnae[]>` (principal first, then codigo).
- `updateEmpresa(empresaId, input: EmpresaInput): Promise<void>` — `UPDATE empresa SET … , updated_at=now() WHERE id=$1`.
- `replaceCnaes(empresaId, cnaes: {codigo, descricao, principal}[]): Promise<void>` — transaction: `DELETE FROM empresa_cnae WHERE empresa_id=$1`, multi-row insert.
- Export builders `buildUpdateEmpresa(empresaId, input)` and `buildInsertCnaes(empresaId, cnaes)` returning `{ text, values }`.
- `web/lib/empresa-queries.test.ts`: builders: `WHERE id = $1` present with empresaId first value; cnpj/cep digits only; porte null when empty; cnaes flatten + exactly one principal enforced by a `validateCnaes()` helper (throws on 0 or >1 principal) — test both.

`web/components/empresa-form.tsx` (`"use client"`, `useActionState(updateEmpresaAction)`): props `empresa`, `cnaes`, `readOnly: boolean`. Sections as cards: "Identificação" (razão social, nome fantasia, CNPJ read-only formatted, natureza jurídica, porte `<select PORTES>`, optante Simples checkbox, IE, IM), "Endereço" (CEP masked, logradouro, número, complemento, bairro, município, UF `<select UF_LIST>`), "Contato" (telefone, email), "CNAEs" → `<CnaeEditor>`. `readOnly` → all inputs `disabled`, no save button. Inline `erro`/`ok` message.

`web/components/cnae-editor.tsx` (`"use client"`): controlled list; rows: codigo (7 digits, masked `0000-0/00`), descricao, radio "principal", remove; "Adicionar CNAE". Serializes into hidden input `cnaes` as JSON so the server action gets one field.

`web/app/empresa/actions.ts`: `"use server"` `updateEmpresaAction(prev, formData)` → `requireAdmin()`; parse + validate (razão social required; CEP valid if given; UF in list; email valid if given; cnaes JSON parse + `validateCnaes`); `updateEmpresa` + `replaceCnaes`; `revalidatePath("/empresa")`; return `{ ok: true }` or `{ erro }`.

`web/app/empresa/page.tsx`: `requireSession()`; title "Minha empresa" (`font-display text-2xl font-bold tracking-tight`) with subtitle razão social; `<EmpresaForm readOnly={role !== "admin"} …/>`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run lib/empresa-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3100/empresa)" = "307" && pkill -f "next-server"`

## Done when
- Logged-in admin edits porte + adds a CNAE, saves, reload shows changes; member sees disabled inputs and no Salvar; `/empresa` without cookie redirects.

## Not included
- No CNPJ change, no re-lookup from BrasilAPI, no users/docs pages, no delete empresa.
