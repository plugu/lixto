---
id: 109
status: doing
model: opus
depends_on: []
max_attempts: 4
files:
  - infra/mail/Dockerfile
  - infra/mail/main.cf
  - infra/mail/entrypoint.sh
  - infra/terraform/main.tf
  - infra/terraform/variables.tf
  - infra/terraform/dns.tf
  - infra/terraform/README.md
---
## Goal
The MTA image and the Cloudflare DNS module exist and are reviewable: Postfix + opendkim that delivers direct-to-MX under Hostinger's rate cap, plus Terraform that owns exactly the five records mail delivery depends on.

## Context

Host facts (verified 2026-09-03): VPS `plugu-prod01` = Hostinger BR, IP **187.127.16.246**, current PTR `srv1897779.hstgr.cloud`. Outbound **port 25 is open**, capped at **5 messages/minute**. DNS for `lixto.com.br` is on Cloudflare (NS nikon/raina). Today the zone actively *forbids* mail: `MX 0 .` (null MX) and `TXT "v=spf1 -all"`. Web/CLI apps run as Dokploy applications from Dockerfiles in this repo (see `Dockerfile.cli`), on the `dokploy-network` Docker network.

**`infra/mail/`** — Postfix + opendkim in one container (`debian:trixie-slim`, `postfix opendkim opendkim-tools rsyslog`):
- `main.cf`: `myhostname = mail.lixto.com.br`, `mydestination =` (empty — send-only), `inet_interfaces = all` but `smtpd_recipient_restrictions` accepting only from the Docker subnet, `mynetworks` = the compose/dokploy subnet, `smtp_tls_security_level = may`, `smtp_dns_support_level = dnssec`, `message_size_limit = 10485760`. Rate cap for Hostinger: `default_destination_rate_delay = 15s`, `default_destination_concurrency_limit = 1`, `initial_destination_concurrency = 1` (≈4 msg/min, under the 5/min ceiling), `maximal_queue_lifetime = 3d`, `bounce_queue_lifetime = 1d`. Milter wiring: `smtpd_milters = inet:localhost:8891`, `non_smtpd_milters = $smtpd_milters`, `milter_default_action = accept`.
- `entrypoint.sh`: on first boot generate the DKIM keypair into the mounted volume (`/var/db/dkim/<selector>.private`, selector from `$DKIM_SELECTOR`, default `lixto`) if absent; **print the public record to stdout** in `v=DKIM1; k=rsa; p=…` form so the operator can paste it into `terraform.tfvars`; write opendkim `KeyTable`/`SigningTable`/`TrustedHosts` for `lixto.com.br`; start rsyslog, opendkim, then `postfix start-fg`.
- `Dockerfile`: installs the packages, copies `main.cf` + `entrypoint.sh`, `VOLUME /var/db/dkim /var/spool/postfix`, `EXPOSE 25`, `ENTRYPOINT ["/entrypoint.sh"]`.

**`infra/terraform/`** — provider `cloudflare/cloudflare ~> 5`, `required_version >= 1.9`, backend `local` (state file gitignored; add `infra/terraform/*.tfstate*` and `*.tfvars` to `.gitignore`). Variables: `cloudflare_api_token` (sensitive), `zone_id`, `domain` (default `lixto.com.br`), `mail_ip` (default `187.127.16.246`), `dkim_selector` (default `lixto`), `dkim_public_key` (sensitive=false, pasted from the container), `dmarc_rua` (default `mailto:dmarc@lixto.com.br`). `dns.tf` — five `cloudflare_dns_record` resources:
1. `mail` A → `var.mail_ip`, **`proxied = false`** (proxying breaks SMTP), ttl 300.
2. `@` MX `10 mail.<domain>`.
3. `@` TXT `v=spf1 a:mail.<domain> -all` — replaces the current deny-all (Terraform will report the change; that is intended).
4. `<selector>._domainkey` TXT → `var.dkim_public_key`.
5. `_dmarc` TXT → `v=DMARC1; p=none; rua=<var.dmarc_rua>; fo=1`.
`README.md`: how to get the zone id + a scoped token (Zone:DNS:Edit), `terraform plan/apply`, where the DKIM public key comes from, and the **manual prerequisite**: set PTR for 187.127.16.246 to `mail.lixto.com.br` in Hostinger hPanel — Gmail/Outlook fail forward-confirmed rDNS without it.

Do **not** run `terraform apply`, and do not build/push the image — the orchestrator does that with real credentials.

## Checks (run in order — cheapest first)
1. `terraform -chdir=infra/terraform fmt -check` (if the `terraform` binary is absent, say so and run `terraform fmt` skipped)
2. `terraform -chdir=infra/terraform init -backend=false && terraform -chdir=infra/terraform validate`
3. `docker build -t lixto-mail:test infra/mail` (if the Docker daemon is unavailable, report it and fall back to `sh -n infra/mail/entrypoint.sh` + `postconf -n` syntax review by eye)
4. `grep -q "proxied *= *false" infra/terraform/dns.tf && grep -q "default_destination_rate_delay" infra/mail/main.cf && grep -q "v=spf1 a:mail" infra/terraform/dns.tf`

## Done when
- `terraform validate` passes with the five records defined and the mail A record un-proxied.
- The image builds (or the blocker is reported) and `entrypoint.sh` generates + prints a DKIM public record when the key volume is empty.

## Not included
- Applying Terraform, creating the Dokploy app, changing PTR (orchestrator steps).
- Bounce parsing (ticket 111), app code of any kind.
