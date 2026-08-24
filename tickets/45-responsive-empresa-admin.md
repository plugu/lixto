---
id: 45
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/components/usuarios-table.tsx
  - web/components/documentos-empresa-table.tsx
  - web/components/empresa-form.tsx
  - web/components/cnae-editor.tsx
  - web/components/documento-upload-form.tsx
  - web/components/convite-form.tsx
---
## Goal
Empresa admin pages (dados, usuários, documentos) usable at 375px: both tables reflow to cards, forms single-column with touch-friendly controls.

## Context
`web/components/usuarios-table.tsx:24` — compact Table, 6 columns (Nome, E-mail, Cargo, Papel, Status, Ações). `web/components/documentos-empresa-table.tsx:48` — compact Table, ~6 columns (Tipo, Arquivo, Validade, Status, Enviado, Ações). Both: below `md` render stacked cards in the same file (name/tipo prominent, secondary fields as label:value lines, ações as buttons in card footer); table `hidden md:block`, cards `md:hidden`. Keep server/client component nature as-is.

Forms: `empresa-form.tsx:54,124,189` sections already `grid grid-cols-1 lg:grid-cols-2` — phone is 1-col already; verify inputs are full-width and sticky save footer (line 214) doesn't cover content at 375px (add bottom padding if needed). `cnae-editor.tsx:65` rows `flex flex-wrap` — verify code+description+remove button wrap cleanly at 375px, fix widths if inputs overflow. `documento-upload-form.tsx`, `convite-form.tsx` — same pattern check: single column, no fixed widths, controls ≥40px tall tap targets.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px: `/empresa`, `/empresa/usuarios`, `/empresa/documentos` have no horizontal page scroll; both tables show cards with working ações; forms submit-able one-handed.
- At ≥768px: tables and forms render as before.

## Not included
- Server actions, validation logic, queries. Page shells (`web/app/empresa/*/page.tsx`) — already simple `flex flex-col` stacks; touch only if a container blocks the card reflow.
