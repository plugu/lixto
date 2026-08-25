# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 13 (preço-alvo) complete: tickets 55-58 done, plus 59 (scheduling moved off the dev machine). All checks green: ruff, 133 pytest, 349 vitest, next build, page probe 200.
- Happy path proven on real data: page view enqueued 1700 itens → drained 900 → 12 itens rendering real medians (R$ 45,00 n=5 … R$ 14,65 n=12), p25 ≤ mediana ≤ p75, winners with porte + date.

## Next
- gate mvp 2/2: user reviews the diff → commit → deploy → run the `db-init` Dokploy schedule so migration 009 reaches prod.
- `sync-resultados` will error nightly until that deploy lands (prod has no `plic sync resultados` and no `resultado` table yet).

## Decisions
- **no scheduling on a dev machine.** launchd module, `plic schedule` command and its tests deleted; README documents Dokploy schedules as the only mechanism. A `com.plic.sync` job was found loaded and actively crawling PNCP from the laptop on 2026-08-25 — uninstalled.
- prod schedules (Dokploy, app `cli`, America/Sao_Paulo): `sync-incremental` `0 6,13,20 * * *`; `sync-resultados` `0 3 * * *` (new); `db-init` and `cnae-classify-30d` manual-only via the Feb-31 cron idiom.
- crawl policy: demand-driven only. Queue on `item`; full crawl of 4.06M homologated itens = ~23 days at 2 req/s.
- `resultado` = promoted columns, no `raw`. ~660 B/row measured with indexes.
- match by description: CATMAT on 0.25% of 7.85M itens — no catalog key exists. FTS retrieval + LATERAL LIMIT 200/item; 43% of matched historical itens have a published resultado.
- n<5 → percentis null in SQL. SRP losing ranks excluded (`ordem_classificacao_srp IS NULL OR = 1`).
- `/resultados` has NO pagination — `pagina` ignored, page N echoes page 1 forever. Handled by `_FirstPageOnly`.

## Blockers
- none. Sizing gap for cycle 14: one page view enqueues ~1700 itens vs 2000/night drained. Raise the limit or add a second run before calling the feature broken.
