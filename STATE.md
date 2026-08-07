# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
idle — cycle 3 complete (10, 11, 12 all done, attempt 1/3 each); awaiting final mvp diff review

## Next
user reviews filtros v2 at /licitacoes

## Decisions
- execution: sequential (cycle 3)
- 10: PORTAIS_ATIVOS top-7 allowlist platform-wide (read-side only)
- 11: multi-value filters + UF + valor + facet counts (64 tests)
- 12: popover multi-selects (native GET form), chips, counts — visually verified
- probe pkill `next-server` also kills dev server — restart dev after runs
- background: `plic classify` draining abertas/futuras via ollama

## Blockers
- none
