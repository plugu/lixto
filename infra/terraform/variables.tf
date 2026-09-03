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
  description = "DMARC aggregate report destination (mailto: URI)."
  type        = string
  default     = "mailto:dmarc@lixto.com.br"

  validation {
    condition     = can(regex("^mailto:[^@\\s]+@[^@\\s]+$", var.dmarc_rua))
    error_message = "dmarc_rua must be a mailto: URI, e.g. mailto:dmarc@lixto.com.br."
  }
}
