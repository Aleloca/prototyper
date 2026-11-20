# Self-hosting Prototyper

Prototyper is a single Node process (Fastify and SQLite through `node:sqlite`). It serves the panel, the API for the MCP and the client review links, and it gets the HTTPS certificates of the panel and of the preview domains from Let's Encrypt. The recommended way to run it is the Docker image `ghcr.io/aleloca/prototyper`. It includes everything: Node, sharp, and a headless Chromium for the project thumbnails.

Two setups:

- **[Dedicated server](#dedicated-server)**: Prototyper answers on ports 80 and 443 by itself. This is the simplest setup.
- **[Next to other sites](#next-to-other-sites-nginx-in-front)**: nginx stays in front, and the other sites keep working as before.

Whichever you choose, you need a hostname for the **panel**, e.g. `prototyper.example.com`, with a DNS A record pointing to the server.

## Dedicated server

Requirements: Docker with the Compose plugin, and ports 80 and 443 free and reachable.

```sh
mkdir prototyper && cd prototyper
curl -fsSLO https://raw.githubusercontent.com/Aleloca/prototyper/main/deploy/docker/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Aleloca/prototyper/main/deploy/docker/.env.example -o .env
# edit .env: PANEL_HOST, ADMIN_EMAIL (and ACME_EMAIL)
docker compose up -d
docker compose logs prototyper
```

On first start:

- the panel's certificate is issued;
- a `SECRET_KEY` is generated in the data volume;
- `ADMIN_EMAIL` becomes the first admin, and the logs print the link to set the password.

Open the link, choose your name and password, and sign in. In **Account**, turn on two-factor authentication: you need it to connect Claude Code. In **Admin**, create a workspace and add a preview domain.

Data and certificates live in two Docker volumes, `data` and `certs` ([`compose.yaml`](../deploy/docker/compose.yaml)).

## Next to other sites (nginx in front)

Use this setup when the machine already serves sites with nginx.

- **Prototyper** listens only on `127.0.0.1:3700` and writes the certificates to a host folder.
- **nginx** is the **default server**: it answers only for hostnames that no other nginx site claims.

Existing sites are not touched.

Requirements: Docker with the Compose plugin, and nginx 1.15.9+.

1. Create the certificates folder. The container user (uid 1000) writes it, and the nginx workers read it through their group (`www-data` on Debian/Ubuntu):

   ```sh
   sudo install -d -o 1000 -g www-data -m 2750 /var/lib/prototyper-certs
   ```

2. Install the nginx site from [`deploy/nginx-prototyper.conf`](../deploy/nginx-prototyper.conf):

   ```sh
   sed -e '/^#/d' -e 's#__CERTS_DIR__#/var/lib/prototyper-certs#g' -e 's#__PORT__#3700#g' nginx-prototyper.conf \
     | sudo tee /etc/nginx/sites-available/prototyper >/dev/null
   sudo ln -s ../sites-available/prototyper /etc/nginx/sites-enabled/prototyper
   sudo nginx -t && sudo systemctl reload nginx
   ```

   The site:

   - on port 80, forwards `/.well-known/acme-challenge/` to Prototyper (certificate challenges) and redirects the rest to HTTPS;
   - on port 443, loads each certificate by name (`ssl_certificate /var/lib/prototyper-certs/$ssl_server_name/fullchain.pem`) and proxies to Prototyper.

   Side effect: hostnames that point to the server but have no site configured anywhere now get Prototyper's "not available" page instead of the first nginx site.

3. Start Prototyper with [`compose.proxy.yaml`](../deploy/docker/compose.proxy.yaml) and a `.env` like the one above:

   ```sh
   docker compose -f compose.proxy.yaml up -d
   docker compose -f compose.proxy.yaml logs prototyper
   ```

The data stays in the `data` volume. To keep it in a host folder instead, set `DATA_PATH=/var/lib/prototyper` in the shell or in a `.env` next to the compose file. The folder must be owned by uid 1000 (`sudo chown -R 1000 /var/lib/prototyper`). `CERTS_PATH` and `PORT` change the certificates folder and the local port.

## Admin commands

```sh
docker compose exec prototyper prototyper create-admin someone@example.com
```

This creates an admin (or re-invites an existing one) and prints a link to set the password. Normally you add people from the panel.

## Updates

```sh
docker compose pull && docker compose up -d
```

The database is migrated on start. `latest` follows `main`; pin a version (`ghcr.io/aleloca/prototyper:1.0`) if you prefer.

## Preview domains

1. Point the domain (an A record, or a CNAME to the panel host) to the server.
2. In the panel, go to **Admin → Preview domains**, add the domain and pick its workspace.

Prototyper then:

- checks the DNS;
- checks that `http://domain/.well-known/...` reaches it;
- gets a Let's Encrypt certificate (HTTP-01) and stores it in the certificates folder.

Certificates are renewed 30 days before they expire. A domain in error shows the reason in the panel, with **Try again**.

Review links of a workspace are served only on that workspace's active domains. The panel host never serves review links, and preview domains never serve the panel.

## Configuration

| Variable | |
|---|---|
| `PANEL_HOST` | Panel hostname. Required. |
| `ADMIN_EMAIL` | On first start, with no users yet, this address becomes the admin and the invite link is printed in the logs. |
| `ACME_EMAIL` | Contact for Let's Encrypt (expiry notices). |
| `SECRET_KEY` | 32+ random characters. It encrypts 2FA secrets and signs preview URLs. Without it, a key is generated on first start and saved as `secret.key` in the data folder. |
| `THUMBNAILS` | `false` turns off the project thumbnails (screenshots taken with headless Chromium). |
| `ACME_STAGING` | `true` uses Let's Encrypt staging (for testing). |
| `STANDALONE` | `true` (the image default): Prototyper serves HTTPS on `HTTPS_PORT` and redirects from `HTTP_PORT`. `false`: plain http on `PORT`, behind a proxy. |
| `TRUST_PROXY` | `true` behind nginx. |
| `DATA_DIR`, `CERTS_DIR` | Data and certificates folders (`/data`, `/certs` in the image). Without `CERTS_DIR`, domains become active as soon as they are added, and TLS is up to you. |
| `HOST`, `PORT`, `HTTP_PORT`, `HTTPS_PORT` | Listen addresses. |

## Backups

Back up the data folder or volume. It holds:

- the SQLite database;
- `projects/` and `uploads/`;
- `secret.key`, if you didn't set `SECRET_KEY` (if you did, back up your `.env`).

Certificates can be issued again.

With volumes:

```sh
docker compose exec prototyper tar czf - -C /data . > prototyper-data-$(date +%F).tgz
```

## Without Docker

[`deploy/deploy.sh`](../deploy/deploy.sh) installs Prototyper over SSH on a server that runs **Node 22.5+**, **pm2** and **nginx 1.15.9+**, next to the other sites:

```sh
SSH_HOST=myserver PANEL_HOST=prototyper.example.com ACME_EMAIL=you@example.com ./deploy/deploy.sh
ssh myserver '/var/www/prototyper/prototyper create-admin you@example.com'
```

It builds the overlay, the panel and the server, and uploads them to `/var/www/prototyper`. On the first run it also:

- creates `.env` with a random `SECRET_KEY`;
- installs the nginx default server above, rolling back if the configuration test fails;
- installs headless Chromium for the thumbnails;
- starts the server with pm2 on `127.0.0.1:3700`.

Later deploys run the same command, and `.env` and the data are kept.

You can override these defaults:

| Variable | Default |
|---|---|
| `APP_DIR` | `/var/www/prototyper` |
| `DATA_DIR` | `/var/lib/prototyper` |
| `CERTS_DIR` | `/var/lib/prototyper-certs` |
| `PORT` | `3700` |
| `PM2_NAME` | `prototyper` |

## Local development

```sh
pnpm install && pnpm build
DATA_DIR=/tmp/pt PANEL_HOST=localhost DEV_HTTP=true ADMIN_EMAIL=you@example.com \
  node --disable-warning=ExperimentalWarning apps/server/dist/server.js
```

With `DEV_HTTP=true`, everything is served over plain http on the port: cookies don't have `Secure`, and links look like `http://host:3700`. Use `localhost` for the panel and a `*.localhost` name (e.g. `preview.localhost`) as a preview domain. Without `CERTS_DIR`, domains become active as soon as they are added.

To build the image locally: `docker build -t prototyper .`.
