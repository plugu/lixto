# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 22 (transactional email, **production** mode) plan approved (2/3). Tickets 108 (outbox+ADR, opus), 109 (Postfix/opendkim image + Terraform Cloudflare DNS, opus), 110 (pt-BR templates, sonnet) running in parallel worktrees ../lixto-wt-{108,109,110}. Then {111 ∥ 112} → 113 → 114 → reviewer pass → approval 3/3.
- Cycle 21 still live in prod: local enrichment loop (`lixto-qwen` on the Mac, US$ 0) drains the fenced backlog at ~22 rows/h; ~2.3k rows enriched, ~6.4k pending in fence. Cloud `enrich-run` schedule stays OFF (OpenAI credits exhausted, Gemini key is free-tier). Cycle-21 diff still awaiting its own approval.

## Next
- Cycle 22 ops after 114: `terraform apply` (Cloudflare) → deploy `lixto-mail` Dokploy app from infra/mail → paste DKIM public key → re-apply → **manual PTR 187.127.16.246 → mail.lixto.com.br in Hostinger hPanel** → schedules `email-worker` (*/5) + `email-digest` (30 8) → Gmail smoke with SPF/DKIM/DMARC passing.
- Cycle 21 open decisions: CNAE cleanup (drop the 3,169 local-model CNAE rows, 45% hallucinated) + validate codes against `cnae_codes`; Gemini billing or OpenAI top-up; enable cloud `enrich-run`; retry the 8 failed backfill units.
- Cycle 23 candidates: deterministic CNAE (FTS/embeddings over `cnae_codes`), password-reset flow, WhatsApp via Evolution, deep analysis (rung 2).

## Decisions
- Cycle 22 dispatch: parallel worktrees ×3 for {108,109,110}, then paired/sequential.
- Cycle 22: outbox with in-transaction enqueue, `FOR UPDATE SKIP LOCKED` claim, backoff [1,5,30,120] min ×5, hard bounce → `email_suppressions`; self-hosted Postfix direct-to-MX on the VPS (port 25 open, Hostinger caps 5 msg/min → Postfix throttled ~4); Terraform owns only 5 Cloudflare records (mail A **un-proxied**, MX, SPF replacing today's `-all`, DKIM, DMARC p=none); DKIM private key never in TF state; PTR manual; relayhost on 587/465 is the escape hatch; unsubscribe = digest only.
- Cycle 21 A/B verdict: local qwen text fields ≈ cloud quality; CNAE unreliable (7% top-code overlap, 45% codes absent from IBGE seed). List ingestion unfenced; details+enrichment fenced (top-3 portals × modalities 6,8 × open only); hard cap 1500/day.
- Legacy DB is reference only, never a data source. `vector` extension needs superuser per DB before `lixto db init`.

## Blockers
- none.
