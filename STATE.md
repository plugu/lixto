# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 8 (mvp, redesign) — tickets 30–37 all done, all attempts 1/3. Branch `cycle8-redesign`; main (incl. ticket-38 font revert + cli webhook) merged in, cycle 8 typography (Instrument Serif/Sans) supersedes the revert by user decision. Final approval (2/2) given.

## Next
merge `cycle8-redesign` → main → push → Dokploy deploy (web + cli webhooks) → prod screenshots → remove worktree

## Decisions
- ticket-38 (system-font revert) applied to pre-redesign main only; cycle 8 fonts win the merge (user confirmed)
- design: docs/design/cycle8-direction.md + canvas https://claude.ai/code/artifact/2d2def4e-ab1f-4066-b7d2-4f63331b183a
- home hero = agent composer UI submitting plain `/licitacoes?q=`; NL→DB agent = cycle 9 candidate
- URL/filter contract frozen; lib/ untouched except db.ts lint; 312 tests green; repo lint green (multi-select fixed t33, sidebar/db t37)
- kit TR href row-link overlay fixed in t37 (THead rowLinks)
- review notes accepted: detail drops "Informação complementar"; CNAE principal = button+badge; auth wordmark "Licitante"
- live: https://plataforma-licitante.site.plugu.solutions — push to main deploys web (web/**) + cli (Actions webhooks, migrations auto-apply on cli start)
- pending outside cycle: company_profile.md still template (triage borderline); Dokploy UPLOADS_DIR volume for documentos

## Blockers
- none
