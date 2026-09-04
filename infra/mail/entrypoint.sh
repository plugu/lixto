#!/bin/sh
# Lixto MTA entrypoint: DKIM key bootstrap, opendkim wiring, then Postfix.
set -eu

MAIL_DOMAIN="${MAIL_DOMAIN:-lixto.com.br}"
MYHOSTNAME="${MYHOSTNAME:-mail.${MAIL_DOMAIN}}"
DKIM_SELECTOR="${DKIM_SELECTOR:-lixto}"
DKIM_KEY_DIR="${DKIM_KEY_DIR:-/var/db/dkim}"
RELAYHOST="${RELAYHOST:-}"
MYNETWORKS="${MYNETWORKS:-}"

# Bounce mailbox (ticket 120). LIXTO_BOUNCE_ADDRESS is the address we want DSNs
# to be sent to; nao-responda@ is added alongside it because that is the
# From:/Return-Path the app sends with today (web/lib/email/sender.ts's
# LIXTO_EMAIL_FROM default), and a DSN follows the envelope sender, not our
# preference. LIXTO_BOUNCE_MAILDIR must match the web container's env of the
# same name — both containers mount the volume that holds it.
LIXTO_BOUNCE_ADDRESS="${LIXTO_BOUNCE_ADDRESS:-bounces@${MAIL_DOMAIN}}"
LIXTO_BOUNCE_MAILDIR="${LIXTO_BOUNCE_MAILDIR:-/var/db/mail/bounces}"
NOREPLY_ADDRESS="${NOREPLY_ADDRESS:-nao-responda@${MAIL_DOMAIN}}"
# virtual(8) writes each message mode 0600 as this uid, and the web container
# reads and moves them: 1000:1000 is `node` in web/Dockerfile.
BOUNCE_UID="${BOUNCE_UID:-1000}"
BOUNCE_GID="${BOUNCE_GID:-1000}"

DKIM_PRIVATE_KEY="${DKIM_KEY_DIR}/${DKIM_SELECTOR}.private"
DKIM_PUBLIC_RECORD="${DKIM_KEY_DIR}/${DKIM_SELECTOR}.txt"

log() {
    echo "[entrypoint] $*"
}

die() {
    echo "[entrypoint] FATAL: $*" >&2
    exit 1
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

    # InternalHosts must include every network the app submits from
    # ($MYNETWORKS), not just loopback: opendkim runs in signing-only mode
    # (Mode s) and silently skips mail from hosts it considers external — a
    # message from the web container would leave unsigned, with no error
    # anywhere (found live 2026-09-04: dkim= absent in Gmail's
    # Authentication-Results). Postfix mynetworks syntax ([::1]/128) is not
    # opendkim syntax, so bracketed IPv6 entries are unwrapped.
    cat >/etc/opendkim/TrustedHosts <<EOF
127.0.0.1
localhost
${MYHOSTNAME}
${MAIL_DOMAIN}
EOF
    for net in ${MYNETWORKS:-$(postconf -h mynetworks)}; do
        echo "$net" | tr -d '[]' >>/etc/opendkim/TrustedHosts
    done

    chown -R opendkim:opendkim /etc/opendkim
}

# --------------------------------------------------------------------------
# 3. Postfix runtime configuration.
# --------------------------------------------------------------------------

# $mynetworks is the only thing standing between this MTA and every other
# container on the shared Dokploy host, so an over-wide value is a hard error,
# not a warning. Get the real subnet with:
#   docker network inspect dokploy-network \
#     -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
check_mynetworks() {
    for cidr in $1; do
        case "$cidr" in
            127.* | "[::1]/128" | ::1/128 | localhost)
                # Loopback: the container's own submissions (postfix DSNs).
                continue
                ;;
            0.0.0.0/0 | ::/0 | "[::]/0")
                die "MYNETWORKS contains ${cidr}: that is an open relay, refusing to start"
                ;;
            */[0-9] | */1[0-5])
                # /0../15 — wider than 65k addresses and never a Docker subnet.
                die "MYNETWORKS entry ${cidr} is wider than a /16; pass the app's own subnet (docker network inspect dokploy-network)"
                ;;
            10.0.0.0/8 | 172.16.0.0/12 | 192.168.0.0/16)
                die "MYNETWORKS entry ${cidr} is a whole RFC1918 block, i.e. every container on the host; pass the app's own subnet"
                ;;
        esac
    done
}

# MAIL FROM allow-list backing smtpd_sender_restrictions in main.cf. Only
# $MAIL_DOMAIN (and its subdomains, via the leading-dot form) may inject mail —
# plus the null sender <>, which every incoming DSN uses (see main.cf). <> is
# harmless on its own: the recipient access map below still limits it to the
# bounce addresses, and reject_unauth_destination still refuses to relay it.
write_sender_access() {
    printf '%s\tOK\n.%s\tOK\n<>\tOK\n' "$MAIL_DOMAIN" "$MAIL_DOMAIN" \
        >/etc/postfix/sender_access
    postmap hash:/etc/postfix/sender_access
}

# The two halves of the bounce mailbox (ticket 120):
#   - bounce_recipients: the RCPT TO allow-list, the only reason a stranger's
#     connection is accepted at all (smtpd_recipient_restrictions).
#   - virtual_mailbox: where those recipients are written. The trailing slash
#     on the value is what makes it a maildir instead of an mbox.
# Both are rebuilt at boot so $LIXTO_BOUNCE_ADDRESS / $MAIL_DOMAIN can change
# without a rebuild.
write_bounce_maps() {
    bounce_base=$(dirname "$LIXTO_BOUNCE_MAILDIR")
    bounce_leaf=$(basename "$LIXTO_BOUNCE_MAILDIR")

    : >/etc/postfix/bounce_recipients
    : >/etc/postfix/virtual_mailbox
    for address in "$LIXTO_BOUNCE_ADDRESS" "$NOREPLY_ADDRESS"; do
        # A duplicate key makes postmap warn and keeps only one entry; the two
        # addresses are identical whenever the operator sets
        # LIXTO_BOUNCE_ADDRESS to the no-reply one.
        if grep -qxF "${address}	OK" /etc/postfix/bounce_recipients; then
            continue
        fi
        printf '%s\tOK\n' "$address" >>/etc/postfix/bounce_recipients
        printf '%s\t%s/\n' "$address" "$bounce_leaf" >>/etc/postfix/virtual_mailbox
    done

    postmap hash:/etc/postfix/bounce_recipients
    postmap hash:/etc/postfix/virtual_mailbox

    postconf -e "virtual_mailbox_base = ${bounce_base}"
    postconf -e "virtual_uid_maps = static:${BOUNCE_UID}"
    postconf -e "virtual_gid_maps = static:${BOUNCE_GID}"

    # Maildir skeleton, plus the failed/ drawer the ingester moves unparseable
    # blobs into. Created here (not by virtual(8), which would create them as
    # needed) so the volume is usable by the web container from the first boot,
    # before any bounce has ever arrived.
    for sub in tmp new cur failed; do
        mkdir -p "${LIXTO_BOUNCE_MAILDIR}/${sub}"
    done
    chown -R "${BOUNCE_UID}:${BOUNCE_GID}" "$LIXTO_BOUNCE_MAILDIR"
    chmod -R 0770 "$LIXTO_BOUNCE_MAILDIR"

    log "bounce mailbox: ${LIXTO_BOUNCE_ADDRESS}, ${NOREPLY_ADDRESS} -> ${LIXTO_BOUNCE_MAILDIR} (uid ${BOUNCE_UID}:${BOUNCE_GID})"
}

configure_postfix() {
    postconf -e "myhostname = ${MYHOSTNAME}"
    postconf -e "mydomain = ${MAIL_DOMAIN}"
    echo "$MYHOSTNAME" >/etc/mailname

    if [ -n "$MYNETWORKS" ]; then
        check_mynetworks "$MYNETWORKS"
        postconf -e "mynetworks = ${MYNETWORKS}"
    else
        check_mynetworks "$(postconf -h mynetworks)"
        log "MYNETWORKS unset; using baked-in mynetworks = $(postconf -h mynetworks)"
    fi
    log "mail injection allowed from: $(postconf -h mynetworks)"

    write_sender_access
    write_bounce_maps

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

    wait_for_opendkim

    log "starting postfix (myhostname=${MYHOSTNAME}, selector=${DKIM_SELECTOR})"
    exec postfix start-fg
}

# opendkim -x daemonises immediately, but the milter socket is not accepting
# yet. Postfix started in that window would hand mail to a dead milter: with
# milter_default_action = tempfail that is a burst of 451s, and with the old
# "accept" it was unsigned mail — the reason this wait exists. Bounded, then
# fail loudly: a container that cannot sign must not run.
wait_for_opendkim() {
    tries=0
    max_tries=100 # 100 x 0.1s = 10s

    while [ "$tries" -lt "$max_tries" ]; do
        if nc -z 127.0.0.1 8891 2>/dev/null; then
            log "opendkim milter accepting on 127.0.0.1:8891 after ${tries} probe(s)"
            return 0
        fi
        tries=$((tries + 1))
        sleep 0.1
    done

    die "opendkim did not accept on 127.0.0.1:8891 within 10s; refusing to start Postfix (it would emit unsigned or tempfailed mail)"
}

setup_dkim_key
print_dkim_record
write_opendkim_config
configure_postfix
start_services
