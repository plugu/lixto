---
id: 36
status: todo
model: sonnet
depends_on: [31]
max_attempts: 3
files:
  - web/app/empresa/page.tsx
  - web/app/empresa/usuarios/page.tsx
  - web/app/empresa/documentos/page.tsx
  - web/components/empresa-form.tsx
  - web/components/cnae-editor.tsx
  - web/components/convite-form.tsx
  - web/components/usuarios-table.tsx
  - web/components/documento-upload-form.tsx
  - web/components/documentos-empresa-table.tsx
---
## Goal
`/empresa`, `/empresa/usuarios`, `/empresa/documentos` become Attio-style settings pages: page header with eyebrow "Empresa", sections separated by tone, kit tables for usuários/documentos, forms on the kit.

## Context
Read `docs/design/cycle8-direction.md` and `web/components/ui/*.tsx` first. Pages are thin server wrappers (33–40 lines) calling `requireSession`/`requireAdmin` and queries; components: `empresa-form.tsx` (279, client, `useActionState(updateEmpresaAction)`, embeds `cnae-editor.tsx` 117), `convite-form.tsx` (91, shows `${origin}/convite/${token}`), `usuarios-table.tsx` (106, client, role select + remove), `documento-upload-form.tsx` (64), `documentos-empresa-table.tsx` (119, server, Tipo/Arquivo/Validade/Status/Ações, download link + remove form).

Rules: do not change action names, field names, `readOnly`/`isAdmin` gating, or query calls. Markup/classes only:
- Each page: `Section eyebrow="Empresa" title=…` header; secondary nav pills (Perfil · Usuários · Documentos) as `LinkButton variant="pill"` with active tone, rendered inline in each page (3 lines, no new shared file).
- `empresa-form`: 2-column field grid on `lg`, `Field` + `Input`/`Select`, CNAE editor rows as hairline list with `Badge` "principal"; sticky bottom action row with primary "Salvar".
- `usuarios-table` / `documentos-empresa-table`: kit `Table density="compact"`; status `StatusDot` (vencido=off, válido=ok, pendente=warn); row actions as ghost icon buttons.
- `convite-form` / `documento-upload-form`: inline `Section` at top of their pages, generated invite link in a mono `Input readOnly` with a Copy ghost button (client, `navigator.clipboard` in try/catch).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s -o /dev/null -w '%{http_code}' localhost:3100/empresa | grep -q '307' && pkill -f "next-server"` (unauthenticated → redirect proves route compiles)

## Done when
- Three settings pages share the new look; all forms submit the same actions with the same field names.

## Not included
- No new actions/queries, no sidebar edits, no auth pages.
