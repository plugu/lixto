variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Zone:DNS:Edit on the lixto.com.br zone."
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Cloudflare zone id for var.domain (dashboard -> zone -> Overview -> API section)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be a 32-character hexadecimal Cloudflare zone id."
  }
}

variable "domain" {
  description = "Apex domain whose mail records this module owns."
  type        = string
  default     = "lixto.com.br"
}

variable "mail_ip" {
  description = "Public IPv4 of the MTA host (plugu-prod01, Hostinger BR). PTR must point back to mail.<domain>."
  type        = string
  default     = "187.127.16.246"

  validation {
    condition     = can(regex("^(\\d{1,3}\\.){3}\\d{1,3}$", var.mail_ip))
    error_message = "mail_ip must be a bare IPv4 address."
  }
}

variable "dkim_selector" {
  description = "DKIM selector; must match DKIM_SELECTOR in the MTA container."
  type        = string
  default     = "lixto"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*$", var.dkim_selector))
    error_message = "dkim_selector must be lowercase alphanumeric with optional hyphens."
  }
}

variable "dkim_public_key" {
  description = <<-EOT
    Full DKIM TXT value ("v=DKIM1; h=sha256; k=rsa; p=..."), copied from the MTA
    container's startup log. Only the public half ever reaches Terraform state;
    the private key stays in the /var/db/dkim volume.
  EOT
  type        = string
  sensitive   = false

  validation {
    condition     = can(regex("^v=DKIM1;.*p=[A-Za-z0-9+/=]+$", var.dkim_public_key))
    error_message = "dkim_public_key must be a full DKIM TXT value starting with v=DKIM1; and ending with the p= base64 key."
  }
}

variable "dmarc_rua" {
  description = <<-EOT
    DMARC aggregate report destination (mailto: URI). It MUST be a mailbox on a
    domain that accepts inbound mail from strangers. It cannot live on
    var.domain: this zone's only MX is the send-only Lixto MTA, which rejects
    everything inbound, so reports addressed there are silently lost and the
    p=none monitoring window yields no data at all.

    The default is a Google-Workspace-hosted mailbox on plugu.solutions.
    Because that is a different organisational domain, the receiving domain
    must also publish the DMARC external-destination authorisation record --
    without it, reporters (Google, Microsoft, Yahoo) drop the reports:

      <var.domain>._report._dmarc.<rua domain>  TXT  "v=DMARC1"
      e.g. lixto.com.br._report._dmarc.plugu.solutions TXT "v=DMARC1"

    That record lives in the other zone and is NOT managed here; see
    README.md "DMARC reports actually arriving".
  EOT
  type        = string
  default     = "mailto:dmarc@plugu.solutions"

  validation {
    condition     = can(regex("^mailto:[^@\\s]+@[^@\\s]+$", var.dmarc_rua))
    error_message = "dmarc_rua must be a mailto: URI, e.g. mailto:dmarc@plugu.solutions."
  }

  validation {
    condition     = !can(regex("@${replace(var.domain, ".", "\\.")}$", var.dmarc_rua))
    error_message = "dmarc_rua must not be a mailbox on var.domain: its only MX is the send-only Lixto MTA, which rejects inbound mail, so the reports would be discarded. Use an externally hosted mailbox."
  }
}
