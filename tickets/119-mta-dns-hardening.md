---
id: 119
status: doing
model: opus
depends_on: []
max_attempts: 4
files:
  - infra/mail/main.cf
  - infra/mail/master.cf
  - infra/mail/Dockerfile
  - infra/mail/entrypoint.sh
  - infra/terraform/dns.tf
  - infra/terraform/variables.tf
  - infra/terraform/README.md
  - .gitignore
  - README.md
---
## Goal
The MTA is not an open relay, actually respects Hostinger's rate cap, never emits unsigned mail, and the DNS runbook produces a valid SPF/MX/DMARC set instead of duplicates.

## Context

Reviewer findings on the infra shipped in ticket 109:
1. **Open relay** — `main.cf:33` sets `mynetworks` to `10.0.0.0/8 172.16.0.0/12 192.168.0.0/16` with `permit_mynetworks` first in `smtpd_relay_restrictions`/`smtpd_recipient_restrictions`: every other container on the shared Dokploy host (and the whole internet if port 25 is ever published, since docker-proxy rewrites the client to `172.17.0.1`) can send DKIM-signed mail as any `@lixto.com.br` address. Restrict `mynetworks`/`MYNETWORKS` to the app's own subnet (document how to obtain it: `docker network inspect dokploy-network`), and add `smtpd_sender_restrictions = check_sender_access hash:/etc/postfix/sender_access, reject` limiting MAIL FROM to `lixto.com.br`.
2. **Rate cap not enforced** — `default_destination_rate_delay`/`default_destination_concurrency_limit` (`main.cf:61`) are **per destination domain**, and `default_process_limit = 10`, so ten recipient domains deliver in parallel, well over Hostinger's 5 msg/min. Add a `master.cf` with the `smtp` transport at `maxproc=1` (or a single rate-limited `slow` transport via `transport_maps`) and copy it in the Dockerfile. State the resulting worst-case rate in a comment.
3. **Unsigned mail after redeploy** — `entrypoint.sh:151` daemonizes `opendkim -x` and starts Postfix immediately with `milter_default_action = accept`, so the first seconds of mail go out unsigned. Wait for `127.0.0.1:8891` to accept a connection (bounded loop, then fail loudly) before `postfix start-fg`.
4. **DNS runbook produces duplicates** — `infra/terraform/README.md:15` claims the first plan reports a *change* to the apex MX/TXT; with empty local state Terraform plans a **create**, leaving the existing `v=spf1 -all` alongside the new SPF (SPF permerror → DMARC fails) and `MX 0 .` alongside `MX 10 mail`. Make the README's pre-apply step mandatory and concrete: `terraform import cloudflare_dns_record.apex_spf <zone_id>/<record_id>` and the same for `apex_mx` (how to find the ids via the API/dashboard), or delete both records first; verify after apply with `dig +short TXT lixto.com.br` and `dig +short MX lixto.com.br` showing exactly one of each.
5. **DMARC reports go nowhere** — `dns.tf:62` uses `fo=1` with no `ruf=`, and `rua=mailto:dmarc@lixto.com.br` points at a domain whose only MX rejects inbound mail, so the `p=none` monitoring window yields zero data. Drop `fo=1` and make `dmarc_rua` default to an externally hosted mailbox (leave the variable, change the default and document it).
6. **Provider unpinned** — `.gitignore:19` ignores `.terraform.lock.hcl` in a production repo. Stop ignoring it and commit the lock file; note in the README that `terraform.tfvars` is intentionally untracked.
7. **Runbook typo** — `README.md:236` tells the operator to set `LIXTO_MAIL_DKIM_PUBLIC_KEY`; the Terraform variable is `dkim_public_key` (`variables.tf:45`), which is also what `entrypoint.sh:62` prints. Fix the name.

Do not run `terraform apply`. Rebuild the image to prove the config parses.

## Checks (run in order — cheapest first)
1. `terraform -chdir=infra/terraform fmt -check && terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate`
2. `docker build -t lixto-mail:test infra/mail`
3. `docker run --rm --entrypoint postconf lixto-mail:test -n > /dev/null` (config parses; report any warning)
4. `grep -q "maxproc=1" infra/mail/master.cf && grep -q "check_sender_access" infra/mail/main.cf && grep -q "terraform import" infra/terraform/README.md && ! grep -q "^infra/terraform/.terraform.lock.hcl" .gitignore && grep -q "dkim_public_key" README.md`

## Done when
- `postconf -n` shows a bounded `mynetworks` and sender restrictions; `master.cf` caps the smtp transport at one process; the entrypoint blocks until opendkim listens; the README's import step is mandatory and verifiable; the lock file is tracked.

## Not included
- Bounce ingestion (ticket 120), applying Terraform or changing PTR (orchestrator).
