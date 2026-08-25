// COMPAT SHIM (ticket 81) — the allowlist now lives in `portals.ts` as
// `ACTIVE_PORTALS`. This alias exists only because modules ticket 81 does not
// own (`lib/match-queries.ts`, `lib/queries.ts` and their tests) still import
// `PORTAIS_ATIVOS` from here. Ticket 82 ports those and deletes this file.
export { ACTIVE_PORTALS as PORTAIS_ATIVOS } from "./portals";
