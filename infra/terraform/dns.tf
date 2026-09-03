locals {
  mail_host = "mail.${var.domain}"

  # 5 minutes: short enough to fix a mail outage quickly, long enough that
  # resolvers are not hammered. Applies to all five records.
  ttl = 300
}

# 1. The MTA itself. proxied = false is mandatory: Cloudflare's proxy only
#    handles HTTP, so an orange-cloud record makes SMTP unreachable and breaks
#    forward-confirmed rDNS (PTR -> mail.<domain> -> A -> var.mail_ip).
resource "cloudflare_dns_record" "mail_a" {
  zone_id = var.zone_id
  name    = local.mail_host
  type    = "A"
  content = var.mail_ip
  ttl     = local.ttl
  proxied = false
  comment = "lixto MTA (terraform: infra/terraform)"
}

# 2. Inbound routing for the apex. Replaces the current null MX ("MX 0 .")
#    that forbids mail for the domain.
resource "cloudflare_dns_record" "apex_mx" {
  zone_id  = var.zone_id
  name     = var.domain
  type     = "MX"
  content  = local.mail_host
  priority = 10
  ttl      = local.ttl
  comment  = "lixto MTA (terraform: infra/terraform)"
}

# 3. SPF. Replaces today's deny-all "v=spf1 -all"; Terraform will report that
#    change on the first plan, and that is intended. Only the MTA host may send.
resource "cloudflare_dns_record" "apex_spf" {
  zone_id = var.zone_id
  name    = var.domain
  type    = "TXT"
  content = "v=spf1 a:mail.${var.domain} -all"
  ttl     = local.ttl
  comment = "lixto SPF (terraform: infra/terraform)"
}

# 4. DKIM public half. The private key is generated inside the MTA's
#    /var/db/dkim volume and never reaches Terraform state.
resource "cloudflare_dns_record" "dkim" {
  zone_id = var.zone_id
  name    = "${var.dkim_selector}._domainkey.${var.domain}"
  type    = "TXT"
  content = var.dkim_public_key
  ttl     = local.ttl
  comment = "lixto DKIM ${var.dkim_selector} (terraform: infra/terraform)"
}

# 5. DMARC in monitoring mode. p=none until the cold IP's reputation is built;
#    tighten to quarantine/reject once aggregate reports look clean.
resource "cloudflare_dns_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "v=DMARC1; p=none; rua=${var.dmarc_rua}; fo=1"
  ttl     = local.ttl
  comment = "lixto DMARC (terraform: infra/terraform)"
}
