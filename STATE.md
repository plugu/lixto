# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Tickets 50–53 done, merged to main (576cd7d..8c5e949). Checks green (ruff, 129 py tests, lint, build, 321 web tests). Live smoke: `plic cnae eval --limit 2` vs local Ollama OK. Awaiting mvp gate 2/2.

## Next
- gate 2/2: user reviews diff → close cycle.
- post-gate: run `plic cnae classify` backlog drain; eval gemma4:12b-mlx vs gpt-oss:20b (~20 rows) before fixing default; deploy + prod env (`PLIC_OLLAMA_URL=http://plugu-local-m4:11434`).

## Decisions
- execution: parallel×2 (51∥52 worktrees, merged + pruned). Cycle 11: CNAE matching, mvp.
- pending/retry = `cnae_classificado_em IS NULL`; classify stamps PER ROW; httpx error → in-flight row unstamped, exit 1.
- two-stage prompt: 87 divisões (batch 10) → subclasses of ≤4 chosen divisões per row; confidence REAL persisted.
- compat filter: predicate skipped when logged out / zero empresa CNAEs; facet counts untouched.
- engine: `PLIC_OLLAMA_URL` + `PLIC_CNAE_MODEL` (default gpt-oss:20b); eval command persists nothing.
- INFRA (keep): symlinked node_modules breaks Turbopack in worktrees — use `cp -Rc`.

## Blockers
- none
