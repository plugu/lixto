# infra/terraform — Cloudflare DNS for Lixto mail

This module owns **exactly five** DNS records in the `lixto.com.br` Cloudflare
zone, the ones outbound mail depends on. Nothing else in the zone is managed
here; unmanaged records are left untouched.

| # | Record | Type | Value |
|---|---|---|---|
| 1 | `mail.lixto.com.br` | A | `var.mail_ip` — **grey cloud, `proxied = false`** |
| 2 | `lixto.com.br` | MX | `10 mail.lixto.com.br` |
| 3 | `lixto.com.br` | TXT | `v=spf1 a:mail.lixto.com.br -all` |
| 4 | `<selector>._domainkey.lixto.com.br` | TXT | `var.dkim_public_key` |
| 5 | `_dmarc.lixto.com.br` | TXT | `v=DMARC1; p=none; rua=<var.dmarc_rua>` |

The zone today actively **forbids** mail: `MX 0 .` (null MX) and
`TXT "v=spf1 -all"`. Terraform does **not** adopt those records by itself —
with empty local state it plans a *create*, which leaves the old record in
place next to the new one. Do the import below **before the first apply**.

## Mandatory pre-apply import (do this or mail breaks)

Cloudflare happily keeps **two** apex TXT records and **two** apex MX records.
If you apply without adopting the existing ones:

- `v=spf1 -all` + `v=spf1 a:mail.lixto.com.br -all` → two SPF records → SPF
  **permerror** → `spf=none/permerror` → **DMARC fails on every message**.
- `MX 0 .` (null MX, "this domain accepts no mail") + `MX 10 mail...` → a
  contradictory MX set that some receivers read as "refuses mail".

So: **import both records first, or delete both first.** Not optional, and not
something the plan output will warn you about — a create looks perfectly
healthy.

### 1. Find the record ids

Either the dashboard (zone → DNS → click the record → the URL / the "···" menu
shows the record id) or the API:

```sh
export CF_API_TOKEN='…scoped Zone:DNS:Edit token…'
export ZONE_ID='…32 hex chars…'

# apex SPF (TXT on the apex, the one starting with v=spf1)
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=TXT&name=lixto.com.br" \
  | jq -r '.result[] | [.id, .content] | @tsv'

# apex MX (the null MX, content ".")
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=MX&name=lixto.com.br" \
  | jq -r '.result[] | [.id, .priority, .content] | @tsv'
```

Each prints `<record_id>\t<content>`; take the id of the SPF TXT (ignore any
other apex TXT, e.g. a domain-verification token — those are unmanaged and must
be left alone) and the id of the `MX 0 .`.

### 2. Import (run from `infra/terraform`, after `terraform init`)

```sh
terraform import cloudflare_dns_record.apex_spf "$ZONE_ID/<spf_record_id>"
terraform import cloudflare_dns_record.apex_mx  "$ZONE_ID/<mx_record_id>"
```

Then `terraform plan` shows an **update in-place** for both (`v=spf1 -all` →
`v=spf1 a:mail… -all`, `0 .` → `10 mail.lixto.com.br`) and a create for the
other three. If it still shows a *create* for `apex_spf` or `apex_mx`, stop:
the import did not take and applying now would duplicate the record.

**Alternative** (equally acceptable, and simpler if the ids are awkward):
delete the `v=spf1 -all` TXT and the `MX 0 .` in the dashboard first, then
apply with no imports. Do one or the other — never neither.

## Manual prerequisite: PTR (do this first)

There is no Hostinger Terraform provider, so reverse DNS is set by hand:

> Hostinger hPanel → VPS `plugu-prod01` → **Settings → PTR / rDNS** →
> set the record for **187.127.16.246** from `srv1897779.hstgr.cloud`
> to **`mail.lixto.com.br`**.

Gmail and Outlook require forward-confirmed reverse DNS: the PTR must resolve
to `mail.lixto.com.br`, and that name must resolve back to `187.127.16.246`
(record 1 above). Without the PTR change, mail is rejected or spam-filed no
matter how good SPF/DKIM/DMARC are. Verify after both steps:

```sh
dig +short -x 187.127.16.246        # -> mail.lixto.com.br.
dig +short mail.lixto.com.br        # -> 187.127.16.246
```

## Getting the credentials

**Zone id** — Cloudflare dashboard → select `lixto.com.br` → *Overview* →
right column, *API* section → **Zone ID** (32 hex chars).

**API token** — *My Profile → API Tokens → Create Token → Create Custom Token*:

- Permissions: **Zone → DNS → Edit**
- Zone Resources: **Include → Specific zone → lixto.com.br**
- (Optional) restrict by client IP, set a short TTL

Do not use the Global API Key: it is account-wide and cannot be scoped.

## Getting the DKIM public key

The private key is generated **inside the MTA container** (`infra/mail/`), in
the `/var/db/dkim` volume, and never enters Terraform state. On first boot the
container prints the record; the file convention is
`/var/db/dkim/<selector>.private` (private) and `<selector>.txt` (BIND
fragment), with the selector taken from `$DKIM_SELECTOR` (default `lixto`), so
the DNS name is `<selector>._domainkey.<domain>`.

```sh
docker logs lixto-mail | grep -A4 'DKIM public record'
# or, on a running container:
docker exec lixto-mail cat /var/db/dkim/lixto.txt
```

Copy the flattened `v=DKIM1; h=sha256; k=rsa; p=...` value into
`terraform.tfvars`. The selector here **must** match `DKIM_SELECTOR` in the
container, otherwise verifiers look up a name that does not exist.

## Usage

```sh
cd infra/terraform
$EDITOR terraform.tfvars      # gitignored, contents below
terraform init

# MANDATORY before the very first apply — see "Mandatory pre-apply import".
terraform import cloudflare_dns_record.apex_spf "$ZONE_ID/<spf_record_id>"
terraform import cloudflare_dns_record.apex_mx  "$ZONE_ID/<mx_record_id>"

terraform plan   -out=mail.tfplan   # apex_spf/apex_mx must be ~ update, not + create
terraform apply  mail.tfplan
```

`terraform.tfvars`:

```hcl
cloudflare_api_token = "…scoped Zone:DNS:Edit token…"
zone_id              = "…32 hex chars…"
dkim_public_key      = "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFA…"

# Defaults, override only if something moves:
# domain        = "lixto.com.br"
# mail_ip       = "187.127.16.246"
# dkim_selector = "lixto"
# dmarc_rua     = "mailto:dmarc@plugu.solutions"
```

`terraform.tfvars` is **intentionally untracked** (`*.tfvars` in `.gitignore`):
it holds the API token. `*.tfstate*` likewise — the state embeds the token.
`.terraform.lock.hcl` is the opposite: it is **tracked on purpose**, so every
operator resolves the same cloudflare provider build. Commit it whenever
`terraform init -upgrade` changes it; never gitignore it.

State is local, so keep the file: losing it makes Terraform try to *create*
records that already exist — the same duplicate-SPF failure as skipping the
import above. If state is lost, re-import all five records before applying.

## DMARC reports actually arriving

`rua` points at a mailbox **outside** `lixto.com.br`, because this zone's only
MX is the send-only MTA, which rejects inbound mail: reports sent to
`dmarc@lixto.com.br` would be discarded and `p=none` would teach us nothing.

Cross-domain reporting needs the receiving zone to authorise it, otherwise
Google/Microsoft/Yahoo silently drop the reports. In the **rua domain's** zone
(not this one, not managed here) publish:

```
lixto.com.br._report._dmarc.plugu.solutions.  TXT  "v=DMARC1"
```

Verify:

```sh
dig +short TXT lixto.com.br._report._dmarc.plugu.solutions   # -> "v=DMARC1"
```

Aggregate reports arrive daily, roughly 24-72 h after the first mail is sent.
If nothing arrives within three days, that authorisation record is the first
thing to check.

## Verifying after apply

The apex records must be **singular** — this is the check that catches a
skipped import:

```sh
dig +short TXT lixto.com.br    # exactly ONE v=spf1 line (v=spf1 a:mail.lixto.com.br -all)
dig +short MX  lixto.com.br    # exactly ONE line: 10 mail.lixto.com.br.
```

If `TXT` shows both `v=spf1 -all` and the new record, or `MX` shows `0 .`
alongside `10 mail`, delete the stale one in the dashboard **now**: until you
do, SPF is a permerror and every message fails DMARC.

Then the rest:

```sh
dig +short mail.lixto.com.br                 # -> 187.127.16.246
dig +short TXT lixto._domainkey.lixto.com.br # -> v=DKIM1; ... p=...
dig +short TXT _dmarc.lixto.com.br           # -> v=DMARC1; p=none; rua=...
```

Then send a message to a real Gmail address and check that the received headers
show `spf=pass`, `dkim=pass` and `dmarc=pass`.

## Notes

- `proxied = false` on the A record is load-bearing. Cloudflare's proxy only
  forwards HTTP(S); an orange-cloud record hides the real IP and breaks both
  SMTP and forward-confirmed rDNS.
- The Cloudflare v5 provider takes TXT values **unquoted** in `content` and
  quotes them at the API boundary. If a plan shows a perpetual diff with extra
  `"` characters, that is the cause — do not add quotes to `terraform.tfvars`.
- DMARC stays at `p=none` while the IP is cold. Tighten only after aggregate
  reports at `var.dmarc_rua` are clean.
