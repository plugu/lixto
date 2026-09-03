FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# "No configuration" keeps the postfix postinst from writing its own main.cf.
RUN echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        postfix \
        opendkim \
        opendkim-tools \
        rsyslog \
        ca-certificates \
        openssl \
        netcat-openbsd \
    && rm -rf /var/lib/apt/lists/* \
    # debian:*-slim strips man pages and docs, which makes
    # `postfix set-permissions` abort on files it cannot find. Drop the doc
    # entries from the manifest; queue and config entries are untouched.
    && sed -i -E '/^\$(manpage|readme|html)_directory/d' /etc/postfix/postfix-files

# Everything to stdout so `docker logs` / Dokploy show mail flow. The extra
# listener is the syslog socket inside Postfix's chroot.
RUN printf '%s\n' \
    'module(load="imuxsock")' \
    'input(type="imuxsock" Socket="/var/spool/postfix/dev/log" CreatePath="on")' \
    'template(name="plain" type="string" string="%syslogtag%%msg%\n")' \
    '*.* action(type="omfile" file="/dev/stdout" template="plain")' \
    > /etc/rsyslog.conf

COPY main.cf /etc/postfix/main.cf
# master.cf caps the outbound smtp transport at one process, which is what makes
# main.cf's default_transport_rate_delay a global 4 msg/min limit.
COPY master.cf /etc/postfix/master.cf
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

# Baseline sender_access so the image is self-consistent (postfix check / the
# smtpd_sender_restrictions map resolve without a boot). entrypoint.sh rewrites
# and re-postmaps it from $MAIL_DOMAIN at start.
RUN printf 'lixto.com.br\tOK\n' > /etc/postfix/sender_access \
    && postmap hash:/etc/postfix/sender_access

ENV MAIL_DOMAIN=lixto.com.br \
    DKIM_SELECTOR=lixto

# DKIM private key (/var/db/dkim/$DKIM_SELECTOR.private) and the mail queue
# must survive redeploys.
VOLUME ["/var/db/dkim", "/var/spool/postfix"]

EXPOSE 25

ENTRYPOINT ["/entrypoint.sh"]
