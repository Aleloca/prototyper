#!/usr/bin/env bash
# Deploy Prototyper to a host that runs Node 22.5+, pm2 and nginx 1.15.9+.
#
#   SSH_HOST=myserver PANEL_HOST=prototyper.example.com ./deploy/deploy.sh
#
# Optional: APP_DIR (default /var/www/prototyper), DATA_DIR (default /var/lib/prototyper),
#           CERTS_DIR (default /var/lib/prototyper-certs), PORT (default 3700), PM2_NAME (default prototyper), ACME_EMAIL (Let's Encrypt contact).
# The first run creates $APP_DIR/.env (with a random SECRET_KEY) and installs the nginx site
# /etc/nginx/sites-available/prototyper as the default server. Other nginx sites are not touched.
# Then create the first admin:  ssh myserver 'cd /var/www/prototyper && ./prototyper create-admin you@example.com'
set -euo pipefail

: "${SSH_HOST:?Set SSH_HOST to the ssh host (or ~/.ssh/config alias)}"
: "${PANEL_HOST:?Set PANEL_HOST, the panel hostname (e.g. prototyper.example.com)}"
APP_DIR="${APP_DIR:-/var/www/prototyper}"
DATA_DIR="${DATA_DIR:-/var/lib/prototyper}"
CERTS_DIR="${CERTS_DIR:-/var/lib/prototyper-certs}"
PORT="${PORT:-3700}"
PM2_NAME="${PM2_NAME:-prototyper}"
ACME_EMAIL="${ACME_EMAIL:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$PANEL_HOST" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid PANEL_HOST: $PANEL_HOST" >&2; exit 1; }

echo "→ Building overlay, panel and server"
pnpm --dir "$ROOT/packages/overlay" build >/dev/null 2>&1
pnpm --dir "$ROOT/apps/panel" build >/dev/null
pnpm --dir "$ROOT/apps/server" build >/dev/null

echo "→ Uploading to $SSH_HOST:$APP_DIR"
ssh "$SSH_HOST" "mkdir -p '$APP_DIR' '$DATA_DIR' && chmod 700 '$DATA_DIR'"
rsync -az --delete --exclude node_modules --exclude .env "$ROOT/apps/server/dist/" "$SSH_HOST:$APP_DIR/"
sed -e '/^#/d' -e "s#__CERTS_DIR__#$CERTS_DIR#g" -e "s#__PORT__#$PORT#g" "$ROOT/deploy/nginx-prototyper.conf" | ssh "$SSH_HOST" "cat > '$APP_DIR/nginx-prototyper.conf'"

echo "→ Installing, configuring nginx and (re)starting $PM2_NAME"
ssh "$SSH_HOST" bash -s -- "$APP_DIR" "$DATA_DIR" "$PORT" "$PM2_NAME" "$PANEL_HOST" "${ACME_EMAIL:--}" "$CERTS_DIR" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"; DATA_DIR="$2"; PORT="$3"; PM2_NAME="$4"; PANEL_HOST="$5"; ACME_EMAIL="$6"; CERTS_DIR="$7"
[ "$ACME_EMAIL" = "-" ] && ACME_EMAIL=""   # (ssh drops empty arguments)
# Non-interactive ssh shells often miss node's bin dir (e.g. nvm installs): add the one next to `node`.
export PATH="/usr/local/bin:$PATH"
NODE_BIN="$(dirname "$(readlink -f "$(command -v node)")")"
export PATH="$NODE_BIN:$PATH"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
# Headless Chromium for the project thumbnails (and its system libraries); a no-op once installed.
npx --no-install playwright-core install --with-deps --only-shell chromium >/dev/null 2>&1 \
  && echo "  chromium for thumbnails: ready" \
  || echo "  chromium for thumbnails: install failed, thumbnails stay off (see docs/self-hosting.md)" >&2

if [ ! -f .env ]; then
  umask 077
  printf 'SECRET_KEY=%s\nPANEL_HOST=%s\nDATA_DIR=%s\nCERTS_DIR=%s\nPORT=%s\nHOST=127.0.0.1\nTRUST_PROXY=true\n' \
    "$(openssl rand -hex 32)" "$PANEL_HOST" "$DATA_DIR" "$CERTS_DIR" "$PORT" > .env
  [ -n "$ACME_EMAIL" ] && printf 'ACME_EMAIL=%s\n' "$ACME_EMAIL" >> .env
  echo "  created $APP_DIR/.env"
fi
umask 022
# A small wrapper for admin commands with the same environment as the server.
printf '#!/usr/bin/env bash\nset -a; . "%s/.env"; set +a\nexec node --disable-warning=ExperimentalWarning "%s/server.js" "$@"\n' "$APP_DIR" "$APP_DIR" > prototyper
chmod 700 prototyper

# Certificates: written by the server (root), read by nginx workers (www-data group).
mkdir -p "$CERTS_DIR"
chgrp www-data "$CERTS_DIR" && chmod 2750 "$CERTS_DIR"

set -a; . ./.env; set +a
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null
else
  pm2 start server.js --name "$PM2_NAME" --node-args="--disable-warning=ExperimentalWarning" >/dev/null
fi
pm2 save >/dev/null

# nginx default server; rolled back if the configuration test fails.
site=/etc/nginx/sites-available/prototyper
if ! cmp -s nginx-prototyper.conf "$site"; then
  [ -f "$site" ] && cp "$site" "$site.bak"
  cp nginx-prototyper.conf "$site"
  ln -sf ../sites-available/prototyper /etc/nginx/sites-enabled/prototyper
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "  nginx: default server installed"
  else
    nginx -t || true
    if [ -f "$site.bak" ]; then mv "$site.bak" "$site"; else rm -f "$site" /etc/nginx/sites-enabled/prototyper; fi
    echo "  nginx: configuration test failed, change rolled back" >&2
    exit 1
  fi
fi
sleep 1
curl -fsS -H "Host: $PANEL_HOST" "http://127.0.0.1:$PORT/" >/dev/null && echo "  $PM2_NAME is up on 127.0.0.1:$PORT"
REMOTE
echo "✓ Deployed. Panel: https://$PANEL_HOST (its certificate is issued on first start)"
