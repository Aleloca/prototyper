# Self-hosting Prototyper

Prototyper is a single Node process (Fastify + SQLite through `node:sqlite`): the panel, the API for the MCP, the client review links and the certificates of the preview domains. It sits behind nginx, next to whatever other sites the machine already serves.

## Requirements

- A Linux server with **Node 22.5+**, **pm2** and **nginx 1.15.9+**, reachable on ports 80 and 443
- SSH access as root (or a user that can write nginx sites and reload nginx)
- A hostname for the **panel**, e.g. `prototyper.example.com`, with a DNS A record pointing to the server

## First deploy

```sh
SSH_HOST=myserver PANEL_HOST=prototyper.example.com ACME_EMAIL=you@example.com ./deploy/deploy.sh
```

It builds the overlay, the panel and the server, uploads them to `/var/www/prototyper`, and on the first run:

- creates `/var/www/prototyper/.env` with a random `SECRET_KEY` (it encrypts 2FA secrets and signs preview URLs: keep it, and back it up with the data);
- installs the nginx site `/etc/nginx/sites-available/prototyper` as the **default server** (see below), tests the configuration and reloads nginx, rolling back if the test fails;
- starts the server with pm2 on `127.0.0.1:3700`.

On start the server gets a Let's Encrypt certificate for the panel host by itself. Then create the first admin:

```sh
ssh myserver '/var/www/prototyper/prototyper create-admin you@example.com'
```

It prints an invite link: open it, choose your name and password, sign in. In **Account**, turn on two-factor authentication (required to connect Claude Code). In **Admin**, create a workspace and add a preview domain.

Later deploys run the same command; `.env` and data are kept.

Defaults you can override: `APP_DIR` (`/var/www/prototyper`), `DATA_DIR` (`/var/lib/prototyper`: database, published versions, client uploads), `CERTS_DIR` (`/var/lib/prototyper-certs`), `PORT` (`3700`), `PM2_NAME` (`prototyper`).

## How nginx is set up

[`deploy/nginx-prototyper.conf`](../deploy/nginx-prototyper.conf) is a `default_server` on ports 80 and 443: it answers for every hostname that **no other nginx site claims**, so existing sites keep working exactly as before. It:

- forwards `/.well-known/acme-challenge/` on port 80 to Prototyper (certificate challenges) and redirects the rest to HTTPS;
- on port 443 loads the certificate by name, `ssl_certificate $CERTS_DIR/$ssl_server_name/fullchain.pem`, and proxies to Prototyper.

Side effect: hostnames that point to the server but are configured nowhere now get Prototyper's "not available" page instead of the first nginx site.

## Preview domains

1. Point the domain (A record, or CNAME to the panel host) to the server.
2. In the panel, **Admin → Preview domains**, add it and pick its workspace.

Prototyper checks the DNS, checks that `http://domain/.well-known/...` reaches it, obtains a Let's Encrypt certificate (HTTP-01) and writes it to `$CERTS_DIR/<domain>/`. Certificates are renewed 30 days before expiry. A domain in error shows the reason in the panel, with **Try again**.

Review links of a workspace are served only on that workspace's active domains; the panel host never serves review links, and preview domains never serve the panel.

## Configuration (`.env`)

| Variable | |
|---|---|
| `SECRET_KEY` | 32+ random characters. Required. |
| `PANEL_HOST` | Panel hostname. Required. |
| `DATA_DIR` | Data folder. |
| `CERTS_DIR` | Where certificates are written. Set: automatic certificates. Unset: domains are active as soon as they are added, and TLS is up to you. |
| `ACME_EMAIL` | Contact for Let's Encrypt (expiry notices). |
| `ACME_STAGING` | `true` to use Let's Encrypt staging (testing). |
| `PORT`, `HOST` | Listen address (default `127.0.0.1:3700`). |
| `TRUST_PROXY` | `true` behind nginx. |

## Backups

Back up `DATA_DIR` (the SQLite database, `projects/` and `uploads/`) and `.env`. Certificates can be re-issued.

## Local development

```sh
pnpm install && pnpm build
DATA_DIR=/tmp/pt SECRET_KEY=$(openssl rand -hex 32) PANEL_HOST=localhost DEV_HTTP=true \
  node --disable-warning=ExperimentalWarning apps/server/dist/server.js
```

`DEV_HTTP=true` serves everything over plain http on the port (cookies without `Secure`, links as `http://host:3700`). Use `localhost` for the panel and a `*.localhost` name (e.g. `preview.localhost`) as a preview domain. Without `CERTS_DIR`, domains become active as soon as they are added (TLS is then up to you).
