# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
idle — cycle 8 (redesign, tickets 30–37) merged to main (8020037), deployed, verified in prod. All attempts 1/3. Cycle-8 worktree removed.

## Next
cycle 9 candidates: NL→DB agent behind the home composer (deferred by user choice); wire fit-triage to empresa record; Dokploy UPLOADS_DIR volume for documentos

## Decisions
- design system: docs/design/cycle8-direction.md + docs/WEB_STYLE.md; canvas https://claude.ai/code/artifact/2d2def4e-ab1f-4066-b7d2-4f63331b183a ; Instrument Serif (display) + Instrument Sans (body) — ticket-38 system-font revert superseded by user decision at merge
- components/ui kit is the styling contract; TR href row-link overlay pattern (THead rowLinks); columns toggle via useSyncExternalStore + localStorage `plic.licitacoes.cols`; sidebar collapse `plic.sidebar`
- home composer submits plain `/licitacoes?q=`; "Agente"/"Abertas" pills decorative until NL agent cycle
- URL/filter contract unchanged; 312 tests green; repo lint green (multi-select t33, sidebar/db t37)
- accepted in review: detail page dropped "Informação complementar"; CNAE principal = button+badge; wordmark "Licitante"
- live: https://plataforma-licitante.site.plugu.solutions — push to main deploys web (web/**) + cli (Actions webhooks; cli runs `plic db init` on start); sync 3×/day 06/13/20 BRT
- company_profile.md still template → triage stays borderline/50
- probe pkill `next-server` kills dev server — restart after runs

## Blockers
- none
