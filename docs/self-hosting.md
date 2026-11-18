# Self-hosting the share server

The share server is a single Node process (Fastify + SQLite through `node:sqlite`) that serves published demos to clients and stores their edits, uploaded images and notes. One server can serve any number of domains; each demo is published on one of them and is only reachable there.

## Requirements

- A Linux server with **Node 22.5+**, **pm2** and **nginx** (with certbot for HTTPS)
- A DNS record (A/AAAA) for each domain you want to use, pointing to the server
- SSH access from your Mac

## First deploy

```sh
SSH_HOST=myserver ./deploy/deploy.sh
```

This builds the server, uploads it to `/var/www/prototyper`, installs `sharp`, creates `/var/www/prototyper/.env` with a random `ADMIN_TOKEN` on the first run, and starts it with pm2 on `127.0.0.1:3700`. Data (SQLite database, published versions and client uploads) lives in `/var/lib/prototyper`.

Override the defaults with `APP_DIR`, `DATA_DIR`, `PORT` and `PM2_NAME`.

## Adding a domain

```sh
SSH_HOST=myserver DOMAIN=preview.example.com ./deploy/add-domain.sh
```

It installs an nginx site from [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) and requests a certificate with certbot. Then, in the app, open **Settings → Share domains → Add share domain** and enter `https://preview.example.com` with the server's admin token:

```sh
ssh myserver "grep ADMIN_TOKEN /var/www/prototyper/.env"
```

The token is stored in the macOS keychain, not in the app's settings file.

## Updating

Run `./deploy/deploy.sh` again: the `.env` and the data directory are kept.

## Backups

Back up `DATA_DIR`. The database uses WAL mode, so copy it with `sqlite3 prototyper.db ".backup backup.db"` or stop the process first.

## Security notes

- Client links are 256-bit random tokens. Anyone with the link can view and edit the demo until you make it read-only or revoke it from the app.
- A share only answers on the domain it was published to; the same token on another domain returns 404.
- Responses carry `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
- Client uploads are limited to JPEG, PNG, WebP, AVIF and GIF, 10 MB, and re-encoded to WebP (max 2400 px, EXIF stripped).
- Rich text from clients is sanitized to `b`, `strong`, `i`, `em`, `a[href]` and `br`.
