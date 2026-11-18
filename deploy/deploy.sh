#!/usr/bin/env bash
# Deploy the share server to a host that runs Node 22+, pm2 and nginx.
#
#   SSH_HOST=myserver ./deploy/deploy.sh
#
# Optional: APP_DIR (default /var/www/prototyper), DATA_DIR (default /var/lib/prototyper),
#           PORT (default 3700), PM2_NAME (default prototyper).
# The first run creates $APP_DIR/.env with a random ADMIN_TOKEN and prints where to read it.
set -euo pipefail

: "${SSH_HOST:?Set SSH_HOST to the ssh host (or ~/.ssh/config alias)}"
APP_DIR="${APP_DIR:-/var/www/prototyper}"
DATA_DIR="${DATA_DIR:-/var/lib/prototyper}"
PORT="${PORT:-3700}"
PM2_NAME="${PM2_NAME:-prototyper}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Building overlay and server"
pnpm --dir "$ROOT/packages/overlay" build >/dev/null 2>&1
pnpm --dir "$ROOT/apps/server" build >/dev/null

echo "→ Uploading to $SSH_HOST:$APP_DIR"
ssh "$SSH_HOST" "mkdir -p '$APP_DIR' '$DATA_DIR' && chmod 700 '$DATA_DIR'"
rsync -az --delete --exclude node_modules --exclude .env "$ROOT/apps/server/dist/" "$SSH_HOST:$APP_DIR/"

echo "→ Installing runtime dependencies and (re)starting $PM2_NAME"
ssh "$SSH_HOST" bash -s -- "$APP_DIR" "$DATA_DIR" "$PORT" "$PM2_NAME" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"; DATA_DIR="$2"; PORT="$3"; PM2_NAME="$4"
# Non-interactive ssh shells often miss node's bin dir (e.g. nvm installs): add the one next to `node`.
export PATH="/usr/local/bin:$PATH"
NODE_BIN="$(dirname "$(readlink -f "$(command -v node)")")"
export PATH="$NODE_BIN:$PATH"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
if [ ! -f .env ]; then
  umask 077
  printf 'ADMIN_TOKEN=%s\nDATA_DIR=%s\nPORT=%s\nHOST=127.0.0.1\nTRUST_PROXY=true\n' \
    "$(openssl rand -hex 32)" "$DATA_DIR" "$PORT" > .env
  echo "  created $APP_DIR/.env (contains the admin token)"
fi
set -a; . ./.env; set +a
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null
else
  pm2 start server.js --name "$PM2_NAME" --node-args="--disable-warning=ExperimentalWarning" >/dev/null
fi
pm2 save >/dev/null
sleep 1
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null && echo "  $PM2_NAME is up on 127.0.0.1:$PORT"
REMOTE
