# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 8 (mvp, redesign) — 30 done (design approved v2); ticket 31 doing (tokens + ui kit + chrome), attempt 1/3, sonnet. Branch `cycle8-redesign`, worktree `../plataforma-licitante-cycle8`.

## Next
31 → 32–36 parallel in sub-worktrees (3 concurrent) → 37 polish → merge to main → deploy → final diff review (approval 2/2)

## Decisions
- execution: hybrid — 30, 31 sequential in cycle worktree; 32–36 parallel sub-worktrees (cap 3); 37 sequential
- design: docs/design/cycle8-direction.md + canvas https://claude.ai/code/artifact/2d2def4e-ab1f-4066-b7d2-4f63331b183a ; fonts Instrument Serif (display) + Instrument Sans (body); tokens canvas/surface/raised/ink/line/accent/ok/warn/off
- home hero = agent composer UI submitting plain `/licitacoes?q=`; NL→DB agent deferred to cycle 9 (user chose A)
- URL/filter contract frozen; lib/ untouched; 312 tests must stay green
- legacy token names aliased until every page migrates (ticket 31)
- cycle 6/7 live: https://plataforma-licitante.site.plugu.solutions — deploy on push to main (web/**); migrations manual via tunnel (`plic db init`)
- probe pkill `next-server` kills dev server — restart after runs

## Blockers
- none
