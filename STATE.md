# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- 50 (cnae schema + IBGE seed) — doing, dispatched to sonnet.

## Next
- 51 (classify routine, Python) ∥ 52 (web compat filter) in worktrees after 50.
- 53 (eval + docs, haiku) after 51.

## Decisions
- execution: parallel×2 (51∥52 only; 50 and 53 sequential). Cycle 11: CNAE matching, mvp.
- pending/retry semantics = `cnae_classificado_em IS NULL`, no status column.
- two-stage prompt: 87 divisões → subclasses of chosen divisões; never all 1359.
- engine: Ollama via `PLIC_OLLAMA_URL` (VPS→plugu-local-m4 over Tailscale); model `PLIC_CNAE_MODEL`.
- INFRA (keep): symlinked node_modules breaks Turbopack in worktrees — use `cp -Rc`.

## Blockers
- none
