---
mode: production
routing_profile: cloud
parallel_default: parallel
---

# Lixto — transactional email, self-hosted (cycle 22)

## What / why
Lixto has no way to reach a user outside the browser. `users` already carries `email` and `invite_token_hash`/`invite_expires_at`, but nothing sends them: invites are dead on arrival, there is no password reset, and the cycle-19 digest only exists if someone opens `/lixto`. VISION §12 lists notifications as the highest-priority gap for the proactive loop. This cycle builds the whole path — persisted outbox, renderer, and a self-hosted MTA on `plugu-prod01` delivering direct-to-MX — so an opportunity found at 08:00 reaches the user's inbox without any third party.

1. **Outbox, not fire-and-forget.** New table `email_messages` (migration 003): `id`, `to_email`, `template`, `payload JSONB`, `subject`, `status` (`queued|sending|sent|failed|suppressed`), `attempts`, `last_error`, `provider_message_id`, `scheduled_for`, `sent_at`, plus `email_suppressions` (address, reason, created_at) for hard bounces and unsubscribes. Every send is enqueued in the same transaction as the business event, so a crash never loses or duplicates mail; a worker drains the queue with bounded retries and exponential backoff, and marks `failed` with the SMTP reply after the last attempt.
2. **Templates.** `welcome` (account created), `invite` (existing token → accept URL), `daily_digest` (only when the company has new attention-scoring opportunities; reuses `digest-queries.ts` so in-app and email agree). Each renders HTML + text from one shared layout, in Portuguese, with a footer link that suppresses digest mail for that address. Account mail is transactional and not unsubscribable; digest mail is.
3. **Self-hosted MTA.** Postfix + opendkim as a container on `plugu-prod01` (Hostinger BR, 187.127.16.246), reachable only on the internal Docker network for submission, delivering **direct-to-MX on port 25** (verified open; Hostinger caps outbound at 5 messages/minute, so the transport is rate-limited with `default_destination_rate_delay` and the queue absorbs bursts). Bounces are parsed back into `email_messages` / `email_suppressions`.
4. **DNS as code.** `infra/terraform/` manages the Cloudflare zone `lixto.com.br`: `mail.lixto.com.br` A → VPS **grey-cloud (proxied = false)**, `MX 10 mail`, SPF replacing today's deny-all `v=spf1 -all`, DKIM selector TXT (public half only — the key is generated inside the MTA volume, never in Terraform state), DMARC `p=none` with a rua mailbox. Terraform owns exactly these records; nothing else. **Manual prerequisite** (no Hostinger provider): PTR for 187.127.16.246 must be changed from `srv1897779.hstgr.cloud` to `mail.lixto.com.br`, or Gmail/Outlook fail forward-confirmed rDNS.
5. **Operational reality.** A cold IP still gets filtered until reputation builds, and bounce handling is ours. The env keeps a documented escape hatch — pointing Postfix's `relayhost` at an external submission service on 587/465 is a config line, not a code change — and `lixto status` gains an `email:` block (queued / sent 24 h / failed 24 h / suppressed) so silent non-delivery is visible.
6. **Dispatch.** `lixto email worker` drains the outbox (Dokploy schedule, every 5 min); `lixto email digest` enqueues the daily digest per company after `recommend-run`. Both log to `agent_runs`.

## Primary user story
As a user who just signed up (or was invited, or forgot my password, or has new matching opportunities), I receive a Portuguese email from Lixto in my normal inbox within minutes, with a working link — and if my address bounces, the system stops mailing it and shows me as failed instead of pretending it was delivered.

## Out of scope
- WhatsApp/push notifications (Evolution API stays for a later cycle)
- Marketing/bulk email, campaigns, open/click tracking
- Inbound email (parsing replies), mailbox hosting for humans
- Per-user notification preferences beyond digest unsubscribe
- Warm-up automation or reputation dashboards
- Password-reset flow: the `password_reset` template ships but nothing enqueues it — the request UI, token storage and consumption are a later cycle (documented as not wired)
- Terraform for anything beyond those Cloudflare records (MTA config, PTR, Dokploy objects stay as they are)

## Success demo
Done when signing up a test company delivers the welcome mail to a real Gmail inbox (not spam) with SPF, DKIM and DMARC all passing, the next morning's digest arrives only because that company has new attention-scoring opportunities, `email_messages` shows `queued → sent` with the MTA's message-id, and a deliberately invalid address ends `failed` with the SMTP reason and lands in `email_suppressions`.
