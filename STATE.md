# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 22 (transactional email, **production** mode) **LIVE in prod 2026-09-04**: tickets 108-121 done, second reviewer pass fixed 2 blockers (forged-DSN suppression guard; bounce ops wiring), pushed 970bbeb. `lixto-mail` Dokploy app (a75n_NAkCS073mkUumhD-, Postfix+opendkim) deployed; DNS (A/MX/SPF/DKIM/DMARC p=none) written via Cloudflare MCP + report-auth TXT in plugu.solutions; migrations 001-004 applied; schedules email-worker (*/5), email-bounces (2-57/5), email-digest (30 8) enabled. Smoke: welcome → Gmail 250 OK; bounce round-trip verified (550 5.1.1 → DSN → maildir → row failed + suppression).
- Cycle 21 still live in prod: local enrichment loop (`lixto-qwen` on the Mac, US$ 0) drains the fenced backlog at ~22 rows/h; ~2.3k rows enriched, ~6.4k pending in fence. Cloud `enrich-run` schedule stays OFF (OpenAI credits exhausted, Gemini key is free-tier). Cycle-21 diff still awaiting its own approval.

## Next
- Cycle 22 leftovers: **manual PTR 187.127.16.246 → mail.lixto.com.br in Hostinger hPanel** (still srv1897779.hstgr.cloud — spam-folder risk until set); verify SPF/DKIM/DMARC pass in Gmail "Show original"; optional: mint scoped CF token + `terraform import` the 5 records so infra/terraform owns them; watch DMARC aggregates at dmarc@plugu.solutions (24-72h).
- Cycle 21 open decisions: CNAE cleanup (drop the 3,169 local-model CNAE rows, 45% hallucinated) + validate codes against `cnae_codes`; Gemini billing or OpenAI top-up; enable cloud `enrich-run`; retry the 8 failed backfill units.
- Cycle 23 candidates: deterministic CNAE (FTS/embeddings over `cnae_codes`), password-reset flow, WhatsApp via Evolution, deep analysis (rung 2).

## Decisions
- Cycle 22 dispatch: parallel worktrees ×3 for {108,109,110}, then paired/sequential.
- Cycle 22: outbox with in-transaction enqueue, `FOR UPDATE SKIP LOCKED` claim, backoff [1,5,30,120] min ×5, hard bounce → `email_suppressions`; self-hosted Postfix direct-to-MX on the VPS (port 25 open, Hostinger caps 5 msg/min → Postfix throttled ~4); Terraform owns only 5 Cloudflare records (mail A **un-proxied**, MX, SPF replacing today's `-all`, DKIM, DMARC p=none); DKIM private key never in TF state; PTR manual; relayhost on 587/465 is the escape hatch; unsubscribe = digest only.
- Cycle 21 A/B verdict: local qwen text fields ≈ cloud quality; CNAE unreliable (7% top-code overlap, 45% codes absent from IBGE seed). List ingestion unfenced; details+enrichment fenced (top-3 portals × modalities 6,8 × open only); hard cap 1500/day.
- Legacy DB is reference only, never a data source. `vector` extension needs superuser per DB before `lixto db init`.

## Blockers
- none.
