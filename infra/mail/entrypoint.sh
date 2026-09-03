#!/bin/sh
# Lixto MTA entrypoint: DKIM key bootstrap, opendkim wiring, then Postfix.
set -eu

MAIL_DOMAIN="${MAIL_DOMAIN:-lixto.com.br}"
MYHOSTNAME="${MYHOSTNAME:-mail.${MAIL_DOMAIN}}"
DKIM_SELECTOR="${DKIM_SELECTOR:-lixto}"
DKIM_KEY_DIR="${DKIM_KEY_DIR:-/var/db/dkim}"
RELAYHOST="${RELAYHOST:-}"
MYNETWORKS="${MYNETWORKS:-}"

DKIM_PRIVATE_KEY="${DKIM_KEY_DIR}/${DKIM_SELECTOR}.private"
DKIM_PUBLIC_RECORD="${DKIM_KEY_DIR}/${DKIM_SELECTOR}.txt"

log() {
    echo "[entrypoint] $*"
}

# --------------------------------------------------------------------------
# 1. DKIM keypair — generated once, inside the mounted volume, never in
#    Terraform state. The public half is printed so the operator can paste it
#    into infra/terraform/terraform.tfvars as dkim_public_key.
# --------------------------------------------------------------------------
setup_dkim_key() {
    mkdir -p "$DKIM_KEY_DIR"

    if [ ! -f "$DKIM_PRIVATE_KEY" ]; then
        log "no DKIM key at ${DKIM_PRIVATE_KEY}; generating 2048-bit keypair"
        opendkim-genkey \
            --bits=2048 \
            --domain="$MAIL_DOMAIN" \
            --selector="$DKIM_SELECTOR" \
            --directory="$DKIM_KEY_DIR"
    fi

    if [ ! -f "$DKIM_PUBLIC_RECORD" ]; then
        # Key survived but the BIND fragment did not: rebuild it from the key.
        log "rebuilding public record from existing private key"
        pubkey=$(openssl rsa -in "$DKIM_PRIVATE_KEY" -pubout 2>/dev/null \
            | grep -v -- '-----' | tr -d '\n')
        printf '%s._domainkey IN TXT ( "v=DKIM1; h=sha256; k=rsa; " "p=%s" )\n' \
            "$DKIM_SELECTOR" "$pubkey" >"$DKIM_PUBLIC_RECORD"
    fi

    chown -R opendkim:opendkim "$DKIM_KEY_DIR"
    chmod 700 "$DKIM_KEY_DIR"
    chmod 600 "$DKIM_PRIVATE_KEY"
}

# Flatten the BIND fragment ( "v=DKIM1; ..." "p=..." ) into one pastable line.
print_dkim_record() {
    record=$(tr -d '\n' <"$DKIM_PUBLIC_RECORD" \
        | sed -e 's/^[^(]*(//' -e 's/).*$//' \
        -e 's/"[[:space:]]*"//g' -e 's/"//g' \
        | tr -s '[:space:]' ' ' \
        | sed -e 's/^ *//' -e 's/ *$//')

    echo "----------------------------------------------------------------"
    echo "DKIM public record — put this in infra/terraform/terraform.tfvars"
    echo "  name : ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}"
    echo "  type : TXT"
    echo "  dkim_public_key = \"${record}\""
    echo "----------------------------------------------------------------"
}

# --------------------------------------------------------------------------
# 2. opendkim configuration (signing only, no verification: we send, we do
#    not receive).
# --------------------------------------------------------------------------
write_opendkim_config() {
    mkdir -p /etc/opendkim /run/opendkim
    chown opendkim:opendkim /run/opendkim

    cat >/etc/opendkim.conf <<EOF
Syslog                  yes
SyslogSuccess           yes
LogWhy                  no
UMask                   007
UserID                  opendkim
Mode                    s
Canonicalization        relaxed/simple
OversignHeaders         From
MinimumKeyBits          1024
Socket                  inet:8891@localhost
PidFile                 /run/opendkim/opendkim.pid
KeyTable                /etc/opendkim/KeyTable
SigningTable            refile:/etc/opendkim/SigningTable
ExternalIgnoreList      /etc/opendkim/TrustedHosts
InternalHosts           /etc/opendkim/TrustedHosts
EOF

    echo "${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN} ${MAIL_DOMAIN}:${DKIM_SELECTOR}:${DKIM_PRIVATE_KEY}" \
        >/etc/opendkim/KeyTable

    printf '*@%s %s._domainkey.%s\n' \
        "$MAIL_DOMAIN" "$DKIM_SELECTOR" "$MAIL_DOMAIN" >/etc/opendkim/SigningTable

    cat >/etc/opendkim/TrustedHosts <<EOF
127.0.0.1
localhost
${MYHOSTNAME}
${MAIL_DOMAIN}
EOF

    chown -R opendkim:opendkim /etc/opendkim
}

# --------------------------------------------------------------------------
# 3. Postfix runtime configuration.
# --------------------------------------------------------------------------
configure_postfix() {
    postconf -e "myhostname = ${MYHOSTNAME}"
    postconf -e "mydomain = ${MAIL_DOMAIN}"
    echo "$MYHOSTNAME" >/etc/mailname

    if [ -n "$MYNETWORKS" ]; then
        postconf -e "mynetworks = ${MYNETWORKS}"
    fi

    # Documented escape hatch: relay through an external submission service
    # instead of delivering direct-to-MX.
    if [ -n "$RELAYHOST" ]; then
        log "relaying through ${RELAYHOST}"
        postconf -e "relayhost = ${RELAYHOST}"
    fi

    # smtpd runs chrooted under Debian; it needs its own copies of these.
    mkdir -p /var/spool/postfix/etc
    for f in resolv.conf hosts services localtime nsswitch.conf; do
        if [ -f "/etc/${f}" ]; then
            cp -f "/etc/${f}" "/var/spool/postfix/etc/${f}"
        fi
    done

    postfix set-permissions
    postfix check
}

# --------------------------------------------------------------------------
# 4. Boot: rsyslog (so opendkim/postfix logs reach docker logs), opendkim,
#    then Postfix in the foreground as PID 1's child.
# --------------------------------------------------------------------------
start_services() {
    # -n (foreground, backgrounded by the shell) keeps rsyslog's stdout wired to
    # the container's stdout; a daemonised rsyslogd would write its /dev/stdout
    # action into /dev/null and every postfix/opendkim log line would vanish.
    log "starting rsyslogd"
    rsyslogd -n &

    log "starting opendkim"
    opendkim -x /etc/opendkim.conf

    log "starting postfix (myhostname=${MYHOSTNAME}, selector=${DKIM_SELECTOR})"
    exec postfix start-fg
}

setup_dkim_key
print_dkim_record
write_opendkim_config
configure_postfix
start_services
