# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
12-filter-bar-ui — dispatched (sonnet)

## Next
finish: mvp diff review (approval 2 of 2)

## Decisions
- execution: sequential (cycle 3)
- 10 done (1/3): PORTAIS_ATIVOS allowlist platform-wide
- 11 done (1/3, 64 tests): LicitacaoFilters arrays (portais/modalidadeIds/statuses/setores/ufs + valorMin/Max), fetchFacetCounts with own-dimension exclusion, buildQueryString emits repeated params
- filters.tsx still old single-select — ticket 12 replaces it
- probe pkill pattern: `next-server`
- background: `plic classify` draining via ollama

## Blockers
- none
