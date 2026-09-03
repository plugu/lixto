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
| 5 | `_dmarc.lixto.com.br` | TXT | `v=DMARC1; p=none; rua=<var.dmarc_rua>; fo=1` |

The zone today actively **forbids** mail: `MX 0 .` (null MX) and
`TXT "v=spf1 -all"`. The first `terraform plan` will therefore report a
*change* to the apex MX and TXT records rather than a create. That is intended
— review the diff, then apply.

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
terraform plan   -out=mail.tfplan
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
# dmarc_rua     = "mailto:dmarc@lixto.com.br"
```

Both `terraform.tfvars` and `*.tfstate*` are gitignored — the token and the
state (which contains it) must never be committed. State is local, so keep the
file: losing it makes Terraform try to re-create records that already exist.

## Verifying after apply

```sh
dig +short mail.lixto.com.br
dig +short lixto.com.br MX
dig +short lixto.com.br TXT
dig +short lixto._domainkey.lixto.com.br TXT
dig +short _dmarc.lixto.com.br TXT
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
