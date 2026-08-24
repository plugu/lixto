---
id: 52
status: done
model: sonnet
depends_on: [50]
max_attempts: 3
files:
  - web/lib/queries.ts
  - web/lib/queries.test.ts
  - web/components/filters.tsx
  - web/components/filter-chips.tsx
  - web/app/licitacoes/page.tsx
---
## Goal
Logged-in users can filter `/licitacoes` by "Compatível com minha empresa" via a `licitacao_cnae × empresa_cnae` match.

## Context
Filter machinery lives in `web/lib/queries.ts`: `parseFilters` reads searchParams, `buildWhereClause` composes predicates; the `fit` filter (analise LEFT-JOIN predicate, `buildFitPredicate`) is the pattern to copy. Add `compat?: boolean` (searchParam `compat=1`) to `LicitacaoFilters`, plus an optional `empresaCnaes: string[]` argument threaded from the page. Predicate when both present:
`EXISTS (SELECT 1 FROM licitacao_cnae lc WHERE lc.numero_controle_pncp = licitacao.numero_controle_pncp AND lc.codigo = ANY($n))` with the codes array as parameter. `compat` set but no session/empresa → ignore the filter.

Page (`web/app/licitacoes/page.tsx`) is public today. Fetch session with `getSession()` (`web/lib/auth.ts`); when logged in, load codes via the empresa CNAE query in `web/lib/empresa-queries.ts` (`getCnaes`) and pass to queries + a new toggle chip in `Filters` (`web/components/filters.tsx`), labeled "Compatível com minha empresa"; also render in `FilterChips` for removal. Logged out → chip absent, param ignored. Facet counts must not break when the filter is active.

Vitest tests in `web/lib/queries.test.ts`: parseFilters accepts `compat`, predicate SQL/params correct, no-session ignore path.

Executed in a git worktree: copy node_modules with `cp -Rc /path/to/main-checkout/web/node_modules web/node_modules` — never symlink (Turbopack breaks).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- Logged in with empresa CNAEs: toggling the chip narrows the list to licitações having ≥1 matching `licitacao_cnae` row; chip removable via FilterChips.
- Logged out: no chip, `?compat=1` is a no-op.

## Not included
- Match badge/score on rows or detail page; weighted scoring.
- Class/grupo-level (partial-code) matching — exact 7-digit subclass only.
- Any Python/pipeline changes (tickets 50–51).
