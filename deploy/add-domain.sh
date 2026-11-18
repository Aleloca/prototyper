#!/usr/bin/env bash
# Point an extra domain to an existing share server (nginx + Let's Encrypt via certbot).
#
#   SSH_HOST=myserver DOMAIN=preview.example.com ./deploy/add-domain.sh
#
# The domain's DNS A/AAAA record must already point to the server. Then add the domain in the
# app (Settings → Share domains) with the same admin token as the server.
set -euo pipefail
: "${SSH_HOST:?Set SSH_HOST}"
: "${DOMAIN:?Set DOMAIN, e.g. preview.example.com}"
PORT="${PORT:-3700}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid domain: $DOMAIN" >&2; exit 1; }

sed -e '/^#/d' -e "s/preview.example.com/$DOMAIN/g" -e "s/127.0.0.1:3700/127.0.0.1:$PORT/" "$ROOT/deploy/nginx.conf.example" |
  ssh "$SSH_HOST" bash -c "'
    set -euo pipefail
    conf=/etc/nginx/sites-available/$DOMAIN
    if [ -e \"\$conf\" ]; then echo \"\$conf already exists, leaving it untouched\"; exit 1; fi
    cat > \"\$conf\"
    ln -s \"../sites-available/$DOMAIN\" \"/etc/nginx/sites-enabled/$DOMAIN\"
    nginx -t
    systemctl reload nginx
    certbot --nginx -d \"$DOMAIN\" --non-interactive --redirect
  '"
echo "✓ https://$DOMAIN now serves the share server"
