# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 14 shipped: Lixto marketing site live at `/`, plataforma em `/dashboard`. Tickets 60–61 done, gate 2/2 aprovado (com rename Liciplus→Lixto e /painel→/dashboard no fechamento).

## Next
- Verificar deploy Dokploy pós-push (webhook no `web`).
- Candidatos ciclo 15: throughput da fila de resultados; `/concorrente/[cnpj]`; qualidade do match FTS+trigram.

## Decisions
- execution: sequential (forge:run 2026-08-25)
- Brand final: **Lixto** (user, no gate final). Rota da plataforma: `/painel` → `/dashboard`; label da sidebar segue "Painel". Login cai em `/` e o proxy manda pra `/dashboard` com cookie `plic_session`.
- 60 (1/3): rotas movidas pra `web/app/(app)/` (URLs inalteradas), root layout bare, chrome em `(app)/layout.tsx`; 6 componentes com imports `@/app/(app)/...`.
- 61 (1/3): landing full-bleed (`app/page.tsx` + 11 arquivos em `components/marketing/`), Fraunces via next/font, tokens marketing no globals.css, metadata/OG. Gotcha: `--font-*` no `@theme` apontando pra var do next/font declarada abaixo de `:root` cai silencioso pra Inter — daí a classe `.font-editorial`.
- Checks finais pós-rename: lint 0 err, build ok, 368/368 vitest, probe: landing "Lixto" ok, `/dashboard` → `/login` deslogado.
- Carried: no scheduling on dev machines (crons = Dokploy no `cli`); crawl demand-driven; `/resultados` sem paginação (`_FirstPageOnly`).

## Blockers
- none.
