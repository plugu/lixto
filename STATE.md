# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- 53 (eval + docs) — doing, haiku, in place on main.

## Next
- after 53: run graphify update, mvp gate 2/2 — diff review with user, then live smoke (`plic cnae classify --limit 5` vs real Ollama).

## Decisions
- execution: parallel×2 (51∥52 done in worktrees, merged + pruned; 50, 53 sequential in place). Cycle 11: CNAE matching, mvp.
- 50 done 22d2e55: cnae ref (1332 rows, 87 divisões), licitacao_cnae, stamp col, `plic cnae seed` idempotent.
- 51 done (forge/t51 merged): two-stage classify, commit/stamp PER ROW (not per batch); abort on httpx error leaves in-flight row unstamped, CLI exit 1 + `aborted` counter.
- 52 done (forge/t52 merged): `compat=1` filter; predicate skipped when logged out or zero empresa CNAEs; facet counts untouched.
- pending/retry semantics = `cnae_classificado_em IS NULL`, no status column.
- engine: Ollama via `PLIC_OLLAMA_URL` (VPS→plugu-local-m4 over Tailscale); model `PLIC_CNAE_MODEL` (default gpt-oss:20b, eval before fixing).
- INFRA (keep): symlinked node_modules breaks Turbopack in worktrees — use `cp -Rc`.

## Blockers
- none
