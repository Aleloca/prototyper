# Prototyper — Design & Architecture

> Status: implemented (v1.0, server-first pivot) · 2026-11-20
>
> Supersedes the desktop-app design (v0.1–0.3). The Electron app is removed; the share server becomes the product.

Prototyper is a self-hosted server for **client review of website prototypes**. You build the prototype however you like (usually with Claude Code in your terminal), publish it with one MCP call, and send the client a link. The client edits texts, swaps images and pins notes right on the page. Back in the terminal, Claude reads that feedback, applies it and publishes the next version on the same link. A web panel shows everything: projects, versions, previews, the client's edits and notes.

## 1. Goals

1. **Review links for clients**: no account, edit texts in place, replace images, pin notes, press *I'm done*; the link stays the same across versions and shows *What's new* and replies to notes. (Unchanged from v0: the overlay is the core.)
2. **Driven from Claude Code**: an MCP server with `login`, `publish`, `check_feedback`, `reply`. Claude does the building and the applying; Prototyper does hosting, review and history.
3. **A panel** to see what's out there: workspaces → clients → projects → versions, live previews, rounds with edits and notes, link management.
4. **Teams**: users, workspaces, a global admin who assigns people to workspaces.
5. **Preview domains** configured from the panel, with automatic HTTPS certificates.
6. **Security**: password login for the panel; two-factor (TOTP) required to authorize the MCP.
7. **Open source** (MIT), one Node process + SQLite, self-hosted.

Non-goals: building or generating sites on the server, creating projects from the panel (projects are created only through Claude/MCP), client accounts, a CMS, production hosting.

## 2. Overview

```
┌──────── Developer's machine ────────┐
│  Claude Code (terminal)             │
│   └─ prototyper MCP (stdio, local)  │──── HTTPS + bearer token ────┐
│        reads ./dist, .prototyper.json│                              │
│        token in ~/.config/prototyper │                              ▼
└─────────────────────────────────────┘        ┌──────── Prototyper server (Node) ─────────┐
                                               │ Fastify · node:sqlite · files on disk     │
 Team member's browser ── panel host ───────▶  │  /           panel (SPA) + /api/panel/*   │
                                               │  /oauth/*    MCP login (PKCE, loopback)   │
                                               │  /api/v1/*   MCP API (bearer token)       │
 Client's browser ── preview domains ───────▶  │  /s/:token/* demo + review overlay        │
                                               │  ACME client: certificates per domain     │
                                               └─────────────────▲─────────────────────────┘
                                                                 │ proxy (all hosts)
                                               nginx: existing sites untouched, one new
                                               site file for the panel host and a default
                                               server for preview domains
```

## 3. Concepts

- **User**: email, name, password, optional TOTP. `is_admin` marks the global admin (the first user, created from the command line).
- **Workspace**: groups clients, projects and preview domains. Every member of a workspace sees and manages everything inside it. There are no roles inside a workspace.
- **Admin**: creates users (invite links), creates workspaces, assigns users to workspaces, manages domains. An admin sees every workspace.
- **Preview domain**: a hostname (e.g. `preview.example.com`) belonging to one workspace. Links of that workspace's projects are served only on its domains.
- **Client**: a name inside a workspace (the customer the prototype is for).
- **Project**: one prototype for a client, with one review link (`https://<domain>/s/<token>/`), a list of versions and review rounds. Created by `publish` from the MCP.
- **Version**: an immutable upload of the built site, with a changelog.
- **Round**: the client's review of one version: edits (by `data-pt` key), uploaded images, notes; `open → submitted → imported`.
- **API token**: issued to an MCP after a 2FA-confirmed login; belongs to a user, revocable from the panel.

## 4. Data model (SQLite)

New tables: `users`, `sessions`, `invites`, `workspaces`, `workspace_members`, `domains`, `clients`, `api_tokens`, `oauth_codes`, `audit_log`.
Existing tables kept: `projects` (gains `workspace_id`, `client_id`, `domain_id`, `created_by`), `versions` (gains `published_by`), `shares`, `rounds`, `edits`, `edit_history`, `uploads`, `comments`.

We start from an empty database: no migration of v0 data.

Passwords: `scrypt` (node:crypto) with per-user salt. TOTP secrets encrypted at rest with a server key (`SECRET_KEY` in `.env`). Session cookies: random 256-bit id, stored hashed, `HttpOnly; Secure; SameSite=Lax`, 30 days sliding. API tokens: random, stored hashed (SHA-256), shown once, 90-day expiry, `last_used_at` tracked.

## 5. The panel

A React + Tailwind SPA served by the server on the **panel host** (`PANEL_HOST`, e.g. `prototyper.aleloca.dev`). The panel host never serves review links; preview domains never serve the panel.

Screens:
- **Sign in** (email + password, then TOTP code if enabled). **Accept invite** (set name and password).
- **Projects** (home): the workspace switcher, then clients and their projects as cards: thumbnail, version, link, round status (*waiting for client* / *feedback to import* / *imported*), last activity. Search.
- **Project**: the link (copy, open, disable, regenerate), domain; **versions** list with changelog and a preview of each version in an iframe; **rounds** with the client's edits (before → after), uploaded images, notes with their position on the page and replies.
- **Account**: name, password, 2FA (enable with QR code, disable), active MCP tokens (revoke).
- **Admin** (admin only): users (invite, disable, reset 2FA), workspaces (create, rename, members), domains (add to a workspace, certificate status, remove).

The panel reads; it does not create projects or versions (that's Claude's job). It can disable or delete links and projects.

## 6. MCP

A local stdio MCP server, distributed as a **Claude Code plugin** from this repository (MCP + a skill + slash commands); the repository is also the plugin marketplace (`.claude-plugin/marketplace.json`). It runs on the developer's machine because `publish` must read the project's files.

Tools:
- `login(server?)`: OAuth 2 authorization code with PKCE and a loopback redirect. Opens `https://<panel>/oauth/authorize?...` in the browser; the user signs in, **must have 2FA enabled** (or is asked to enable it now) and **must enter a fresh TOTP code**, then confirms *Authorize Claude Code on <machine>*. The MCP receives the code on `http://127.0.0.1:<port>/callback`, exchanges it for an API token and stores it in `~/.config/prototyper/credentials.json` (0600). From then on every call acts as that user.
- `whoami`: user, workspaces, domains.
- `publish(dir, name?, client?, workspace?, domain?, changelog?)`: packs the built site folder (tar.gz), uploads it as a new version, returns the link. The first call creates the project (asks Claude to pick client/workspace/domain only when ambiguous) and writes `.prototyper.json` (server, project id) in the project root; later calls add versions to the same project and link.
- `check_feedback()`: the latest submitted round: edits by key and page with old/new values, uploaded images (downloaded into `./.prototyper/rounds/<n>/`), notes with page, anchor (selector, nearby text, position) and author.
- `reply(round, changelog, replies)`: marks the round imported, stores the replies to notes; the next `publish` shows *What's new* and the replies to the client.
- `lint(dir)`: checks the `data-pt` contract on the built HTML (from `packages/shared`).
- `clone_project(project, dir?)`: downloads a project's sources (or, for projects published before sources were kept, the built site of the latest version) into a new folder linked to the project.
- `pull_sources()`: merges teammates' newer sources into the folder (three-way, conflicts left as markers for Claude to resolve).

The skill teaches Claude the `data-pt` contract (which elements get keys, key naming, stable keys across versions) and the loop: build → `lint` → `publish` → later `check_feedback` → apply edits in the **sources** (by key; works with plain HTML, Astro, React…) → address notes → build → `publish` → `reply`.

Authorization is per user: every MCP call is checked against the user's workspaces.

### Project sources (internal git)

Each project has a bare git repository on the server (`DATA_DIR/git/<projectId>.git`), served over git's smart HTTP protocol (`git http-backend`) at `https://<panel>/git/<projectId>.git`. It is authenticated with the MCP token: no git account, the Prototyper login is the access. Only `main` can be pushed (pre-receive hook, no force pushes, no deletions); the server tags `v<n>` on the commit each version was built from (`versions.commit_sha`), and the panel offers each version's code as a zip.

On the developer's machine the MCP keeps the sources in a **private** repository inside the project (`.prototyper/git`, work tree = the project folder), so the user's own `.git` (branches, index, history) is never touched. `publish` stages the folder as git sees it (`.gitignore` applies) minus dependencies, secrets (`.env*`, keys), Prototyper's files and the build output, commits on top of the server's `main` and pushes. `refs/prototyper/base` records the server commit the folder last synced with: when the server moved past it (a teammate published), `publish` stops and asks for `pull_sources`, which merges with `git merge-tree` and writes the result into the folder.

## 7. Preview domains and HTTPS

The server already runs nginx for other sites; **those sites are not touched**. One new nginx site file is added:

- a **default server** on ports 80 and 443 for every hostname nginx doesn't otherwise know. Port 80 proxies `/.well-known/acme-challenge/` to Prototyper and redirects the rest to HTTPS. Port 443 loads the certificate by name (`ssl_certificate /var/lib/prototyper-certs/$ssl_server_name/fullchain.pem`) and proxies to Prototyper. The panel host is served the same way, with its certificate also managed by Prototyper.

When an admin adds a domain in the panel, Prototyper checks that its DNS points to the server, obtains a Let's Encrypt certificate itself (ACME HTTP-01, `acme-client`), writes it where nginx reads it, and renews it 30 days before expiry. No nginx reload, no root, no shell. Requests for hostnames that are not an active preview domain get 404.

(Caddy with on-demand TLS was considered: it would need port 443, which nginx owns, so every existing site would have to move behind an SNI router. The default-server approach gives the same "point DNS, add in panel" experience without touching them.)

Side effect: hostnames pointed at the server but configured nowhere now get Prototyper's 404 instead of falling through to the first nginx site.

## 8. Security

- Review links: unguessable token (as in v0); clients are anonymous; rate limits on public writes; uploads re-encoded with sharp.
- Panel: login rate limiting and lockout, CSRF protection (SameSite + `Origin` check on state-changing requests), strict CSP, no review-link content on the panel origin (demos are untrusted HTML; they live on preview domains).
- MCP: tokens only after password + TOTP; PKCE, exact loopback redirect, single-use 60-second codes; tokens hashed, revocable, expiring.
- Audit log of logins, token issuance, domain and membership changes.

## 9. Repository after the pivot

| Path | What |
|---|---|
| `apps/server` | Fastify server: panel API, MCP API, OAuth, review links, ACME |
| `apps/panel` | Panel SPA (React, Tailwind, Vite), built into the server bundle |
| `packages/overlay` | Review toolbar injected into review links (unchanged) |
| `packages/shared` | `data-pt` contract and linter |
| `packages/mcp` | The MCP server (bundled to a single file for the plugin) |
| `plugin/` | Claude Code plugin: MCP config, skill, commands |
| `deploy/` | Docker Compose files (standalone, or behind nginx), deploy script without Docker, nginx site template |

Removed: `apps/desktop`, `packages/prototype-kit` (its contract rules move into the skill), the macOS release pipeline.

## 10. Milestones

1. **Server core**: users, sessions, workspaces, domains, clients; projects scoped to workspaces; first-admin command; tests.
2. **Panel**: sign-in, invites, projects, project detail with versions/previews/rounds, account (2FA), admin screens.
3. **Domains**: ACME certificates, nginx default server, deploy on the existing server alongside the other sites.
4. **MCP + plugin**: OAuth login with 2FA, tools, skill, commands; end-to-end test from a separate project.
5. **Cleanup**: remove the desktop app, rewrite README and docs, release.
