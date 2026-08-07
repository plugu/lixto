# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
11-query-layer-v2 — dispatched (sonnet)

## Next
12-filter-bar-ui

## Decisions
- execution: sequential (cycle 3)
- 10 done (1/3, 41 tests): PORTAIS_ATIVOS allowlist base predicate everywhere; WHERE never empty now
- porDia keeps allowlist in JOIN ON clause (preserves zero days)
- probe pkill pattern is `next-server` (Next 16 process title), fixed in tickets 11-12
- background: `plic classify` draining abertas/futuras via ollama

## Blockers
- none
