# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 23 (remove chat interface, **mvp**) code complete: tickets 122 (delete /lixto page, /api/chat, components/chat, lib/agent chat modules; welcome email → /dashboard) and 123 (docs/env purge) both done in 1 attempt; web suite 471/471, build clean. Awaiting push + deploy.
- Cycle 22 (transactional email) CLOSED 2026-09-04: MTA + DNS + PTR live, SPF/DKIM/DMARC all pass, bounce round-trip verified, schedules enabled.

## Next
- Deploy cycle 23 to prod (push → lixto-web autoDeploy; remove LIXTO_CHAT_MODEL from Dokploy lixto-web env — ops, one line).
- Cycle 22 follow-ups: watch DMARC aggregates at dmarc@plugu.solutions (24-72h), then tighten p=none → quarantine; optional terraform import of the 5 DNS records.
- Cycle 21 open decisions: CNAE cleanup (drop 3,169 local-model rows, 45% hallucinated); Gemini billing or OpenAI top-up; enable cloud enrich-run.
- Cycle 24 candidates: password-reset flow (template ships, nothing enqueues it), deterministic CNAE, WhatsApp via Evolution.

## Decisions
- Cycle 23 dispatch: sequential in place (tickets small; worktree overhead not worth it).
- Cycle 23 keeps `lib/agent/embed.ts` + `llm.ts` (semantic search/recommend depend on them) and the `conversations` tables (ADR 001 — never altered, just unused).
- Cycle 22: outbox in-transaction enqueue; self-hosted Postfix direct-to-MX; unmatched hard DSNs are quarantined, never suppressed (forged-DSN guard); opendkim InternalHosts must include the app subnet (5ea22e4).
- Legacy DB is reference only. `vector` extension needs superuser per DB before `lixto db init`.

## Blockers
- none.
