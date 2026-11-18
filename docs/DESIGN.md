# Prototyper — Design & Architecture

> Status: implemented (v0.1.0) · 2026-11-18

Prototyper is a macOS desktop app (Electron) for building landing pages and small multi-page demo sites with Claude Code, collecting client feedback directly on the demo, and iterating version by version until the client approves. The approved demo is then exported as the starting point for the real project.

## 1. Goals

1. **An organized library**: every demo, grouped by client, with versions, status and preview.
2. **Generation through your own Claude Code**: the app drives the locally installed, already-authenticated `claude` CLI. It stores no API keys and ships no credentials.
3. **One link for the client**: the client opens the demo in a browser, no account needed, and can
   - edit texts in place,
   - replace images,
   - drop notes pinned to a spot on the page,
   - submit the review round with "I'm done".
4. **A version loop**: reopen the demo in the app, review all feedback, accept or reject it, and generate the next version. The client's link stays the same across versions.
5. **Brand and references**: extract design guidelines from the client's website and attach reference screenshots.
6. **Export**: a clean static site plus a handoff pack that kicks off development.
7. **Open source** (MIT): everyone self-hosts their own share server.

Non-goals, at least for now: a CMS, production hosting, structural editing by the client (adding or reordering sections is requested through a note), real-time multi-user collaboration, Windows and Linux builds.

## 2. Overview

```
┌──────────────────────────── Developer's Mac ───────────────────────────┐
│  Electron app                                                          │
│  ├─ Library (clients → demos → versions)                               │
│  ├─ Claude runner ──spawn──▶ `claude -p --output-format stream-json`   │
│  ├─ Brand extractor (hidden BrowserWindow)                             │
│  ├─ Build (Tailwind) + data-pt contract linter                         │
│  └─ Sync client ──HTTPS + admin token──┐                               │
│                                        │                               │
│  ~/Prototyper/  (plain files + one git repo per demo)                  │
└────────────────────────────────────────┼───────────────────────────────┘
                                         ▼
                 ┌────────── Share server (Node, Docker, self-hosted) ────────┐
                 │  Fastify · SQLite · files on disk · Caddy for HTTPS        │
                 │  /api/admin/*   publish versions, read feedback            │
                 │  /s/:token/*    serve the demo + inject the review overlay │
                 │  /s/:token/api  store edits, images, notes                 │
                 └──────────────────────────▲─────────────────────────────────┘
                                            │
                                 Client's browser (no login)
```

## 3. The prototype contract (the key idea)

The whole edit loop rests on one rule: **every editable piece of content has a stable key**.

- Pages are **static HTML** with Tailwind and minimal JS, one folder per demo.
- Every editable text, image or link carries a `data-pt` attribute with a semantic key:

```html
<h1 data-pt="home.hero.title">Tax advice for business owners</h1>
<p  data-pt="home.hero.lead" data-pt-type="rich">Supporting <b>SMEs</b> for 20 years…</p>
<img data-pt="home.hero.image" src="assets/hero.jpg" alt="Our office">
<a  data-pt="global.nav.contact" href="contact.html">Contact us</a>
<section data-pt-bg="home.cta.bg" style="background-image:url(assets/cta.jpg)">…</section>
```

- Types:
  - `text` (default): plain text;
  - `rich`: bold, italic and links;
  - `image`;
  - `link`: label and URL;
  - `bg`: background image.
- Keys are demo-wide. The same key on several pages (header, footer) holds the same content, so one edit propagates everywhere.
- After every generation a **linter** checks for:
  - duplicate keys with different content;
  - visible text without a key;
  - images without `data-pt`;
  - broken internal links.

  Errors are fed back to Claude automatically (at most 2 attempts) until lint passes.
- The rules ship as a `CLAUDE.md` copied into each demo, plus a system prompt passed with `--append-system-prompt`.

Why this matters: client edits are **applied deterministically**. The app parses the HTML and splices content by key, using source locations so the rest of the file stays byte-for-byte unchanged, without going through Claude. That saves tokens and removes the risk of Claude "rewriting" approved copy. Claude only receives the notes, i.e. the requests that actually need judgment.

## 4. Desktop app

**Stack**: Electron, electron-vite, React and TypeScript. macOS only (Apple Silicon builds). UI in English and Italian.

### 4.1 Library on disk

The library is made of plain files, so it stays usable if you open a folder with Claude Code by hand:

```
~/Prototyper/                       (configurable)
  clients/
    acme/
      client.json                   name, website, contacts
      brand/                        shared by all of the client's demos
        BRAND.md  tokens.css  brand.json  logo.svg  screenshots/
      demos/
        landing-2027/
          prototyper.json           id, status, published version, share token, Claude session
          CLAUDE.md                 contract + brief
          brief.md
          references/               reference screenshots + notes.md
          src/                      *.html, assets/, styles.css
          dist/                     build output (generated, git-ignored)
          .prototyper/rounds/       imported feedback, one folder per round
          .git/                     one commit + tag (v1, v2, …) per version
```

### 4.2 Screens

- **Library**: grid of clients and demos with thumbnail, status and a badge such as "3 new client edits".
  Statuses: `draft` → `in review` → `feedback received` → … → `approved` → `exported`.
- **New demo** wizard:
  - client;
  - name;
  - brief (free text: paste emails or notes);
  - pages (Home, About, Services, Contact…);
  - brand source: extract from website, reuse the client's saved brand, or "propose one";
  - references.

  Optional "show me the structure first": Claude proposes the sitemap and sections, you approve, then it generates.
- **Demo workspace**:
  - preview on the left, with desktop, tablet and mobile sizes;
  - Claude panel on the right, with chat and streaming activity;
  - version timeline;
  - Publish / Copy link / Export.
- **Feedback review**:
  - list of edits (before and after, accept or reject each);
  - uploaded images;
  - notes with context;
  - an "extra instructions" field;
  - **Generate v(n+1)**.

### 4.3 Claude runner

The app spawns the installed CLI. It uses no SDK and no API key:

```
claude -p --output-format stream-json --verbose --include-partial-messages \
  --input-format stream-json \
  --permission-mode acceptEdits \
  --allowedTools Read Write Edit Glob Grep \
  --append-system-prompt "<prototyper rules>" \
  --add-dir <client brand folder> \
  --resume <demo session id>
```

- `cwd` is the demo folder, so Claude touches nothing else.
- Each demo has its own session (`--resume`), so Claude keeps context across review rounds.
- The streamed JSON feeds the activity panel (files changed, messages). A run can be cancelled at any time.
- "Open in Terminal" is the escape hatch: it starts an interactive `claude` session in the demo folder.
- Requirement: Claude Code must be installed and logged in. The app checks this on first launch.

### 4.4 Build and preview

- The app compiles Tailwind v4 (the `tailwindcss` package is bundled), turning `src/` into `dist/`.
- A small local HTTP server serves `dist/` for the preview, which live-reloads when Claude changes files.
- The home-page thumbnail is captured with `capturePage()`.

### 4.5 Placeholder images

Claude has no real photos. By default it generates SVG placeholders with a descriptive caption ("Team photo in the office, natural light"), which also tells the client what to upload. An optional Unsplash integration, using the user's own key, can come later.

## 5. Share server

**Stack**: Node 22.5+, Fastify, SQLite through the built-in `node:sqlite` (no native database driver) and files on disk. It is bundled into a single file and deployed with pm2 behind nginx + certbot (see [self-hosting](self-hosting.md)); a Docker image may follow.

**Several domains**: one server can answer on many domains. In the app, Settings lists the share domains (base URL + admin token, kept in the macOS keychain) and each demo is published on one of them. A share stores its domain and returns 404 on any other, so one client never sees another client's demo under their domain.

### 5.1 Data model

```
projects   id, name, created_at
versions   id, project_id, number, published_at, changelog_md, files_path
shares     token (32 bytes base64url), project_id, current_version_id, status (open|readonly|revoked)
rounds     id, share_token, version_id, status (open|submitted|imported), submitted_at
edits      id, round_id, key, kind, page, before, after, author, updated_at   (one live row per key + history)
uploads    id, round_id, key, path, mime, width, height
comments   id, round_id, page, anchor_json, text, author, status, reply, created_at
```

### 5.2 API

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`. The token is set in the server's `.env` and in the app settings.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/projects` | create a project |
| POST | `/api/admin/projects/:id/versions` | upload `dist/` (tar.gz) and the changelog |
| POST | `/api/admin/projects/:id/share` | create the link, or move it to the latest version |
| PATCH | `/api/admin/shares/:token` | set `open`, `readonly` or `revoked` |
| GET | `/api/admin/projects/:id/feedback?since=` | edits, uploads and notes from open or submitted rounds |
| GET | `/api/admin/uploads/:id` | download an uploaded image |
| POST | `/api/admin/rounds/:id/imported` | close a round, with replies to the notes |

Public endpoints are protected only by the secret token in the URL:

| Method | Path | Purpose |
|---|---|---|
| GET | `/s/:token/*` | files of the current version, with `review.js` injected |
| GET | `/s/:token/api/state` | current edits, notes and changelog |
| PUT | `/s/:token/api/edits/:key` | save an edit (autosave) |
| POST | `/s/:token/api/uploads` | upload an image (multipart) |
| POST/PATCH/DELETE | `/s/:token/api/comments` | manage notes |
| POST | `/s/:token/api/submit` | "I'm done" |

### 5.3 Security (with a secret-link-only model)

- 256-bit tokens, compared in constant time. Responses send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`, so the token never leaks through referrers.
- Links can be revoked or set to read-only from the app (for example after approval).
- Uploads: JPEG, PNG and WebP only (no SVG), 10 MB max, re-encoded with `sharp`, which strips EXIF and caps the size at 2400 px.
- `rich` text is sanitized against an allowlist (`b`, `i`, `em`, `strong`, `a[href]`, `br`). `text` stays plain text.
- Public APIs are rate-limited, and demos are served with a sensible CSP.

## 6. Review overlay (client side)

`review.js` is vanilla TypeScript bundled into a single file. The server injects it, and it runs in a Shadow DOM so it never clashes with the demo's styles.

- **Floating toolbar** with three modes: 👁 View · ✏️ Edit · 💬 Comment. It also offers the note list, "What changed" and **I'm done**.
- **First visit**: asks for the visitor's name, stored in localStorage, so edits and notes can be attributed.
- **Edit mode** highlights the `data-pt` elements:
  - `text` becomes `contenteditable="plaintext-only"`, and `rich` gets a mini toolbar (bold, italic, link);
  - clicking an image opens a file picker; the image is resized in the browser, uploaded and previewed immediately;
  - `link` opens a popover for label and URL;
  - changes autosave with a debounce, a "saved" indicator confirms them, and each element has a "restore original" action.
- **Comment mode**:
  - click anywhere to drop a pin;
  - the pin is anchored to the nearest `data-pt` element (or a CSS selector), with a percentage offset and the viewport width, so it stays in place across screens;
  - notes are grouped by page and can be edited or deleted while the round is open.
- **Next version**: on opening, the client sees "What's new in v3" (the changelog written by Claude), and each note from the previous round shows its status (✅ resolved / 💬 reply).
- **Mobile**: the toolbar moves to the bottom and pins are dropped with a long-press.

## 7. The version loop

1. **Generate v1**: Claude receives the brief, brand and references. The app builds, then lints, with auto-fix if needed. Commit + tag `v1`.
2. **Publish**: the app tars `dist/`, calls `POST versions` then `share`, and copies the link to the clipboard.
3. **The client works**: edits and notes are stored on the server. The round is `open`, and becomes `submitted` when the client clicks "I'm done".
4. **Notify**: the app polls the server every few minutes and shows a badge and a system notification.
5. **Import and review**: the feedback is downloaded into `.prototyper/rounds/1/`: `feedback.json`, the images, and a readable `feedback.md`.
6. **Apply accepted edits** deterministically: keys are replaced across all pages and images are copied into `assets/`. Commit "Client edits, round 1".
7. **Generate v2**: Claude receives `feedback.md`, containing the accepted notes only, with anchors and cropped screenshots of the commented area, plus your extra instructions. Claude must:
   - address the requests;
   - leave the just-approved copy alone unless a note explicitly asks otherwise;
   - write a `CHANGELOG` and a reply to each note.

   The app lints, then commits and tags `v2`.
8. **Republish**: same link, new round. Repeat until **Approve**: the link becomes read-only and the demo is marked `approved`.

## 8. Brand and references

### 8.1 Extracting a brand from the client's website

1. A hidden `BrowserWindow` (Electron's own Chromium, no Playwright) loads the home page and up to 3 internal pages picked from the navigation.
2. An extraction script collects:
   - **Colors**: frequency of computed colors for backgrounds, text, borders and buttons, clustered by similarity.
   - **Fonts**: families, `@font-face` sources, weights, and the size scale of headings and body text.
   - **Shapes**: radii, shadows, recurring spacing, and button styles (default state).
   - **Logo**: the img or svg in the header, the favicon, `og:image`.
   - **Copy**: a sample of the page text, used to infer the tone of voice.
   - **Screenshots**: full-page, desktop and mobile.
3. The raw output goes to `brand/brand.json` and `brand/screenshots/`.
4. Claude reads the data and screenshots and writes `BRAND.md` (palette with roles, typography, components, tone of voice, don'ts) and `tokens.css` (CSS variables and a Tailwind theme).
5. A **brand editor** in the app lets you edit color swatches, fonts and the logo. The brand is saved per client and reused across all of the client's demos.

Proprietary fonts: when a font isn't available, Claude picks a similar Google Font and flags the substitution in `BRAND.md`.

### 8.2 References

- Drag or paste screenshots into a demo, with an optional note: "love this hero", "layout yes, colors no".
- You can also enter a website URL, and the app captures a full-page screenshot.
- Everything lands in `references/` with `notes.md`. Claude reads the images with its Read tool.

## 9. Export

- **Static site**: a zip of a clean `dist/`, with `data-pt` attributes optionally stripped.
- **Handoff pack**, as a zip:
  - `site/`: the static site;
  - `brand/`: `BRAND.md`, `tokens.css`, logo and fonts;
  - `content.json`: every key with its final text, by page, ready for a CMS;
  - `decisions.md`: the round history, i.e. what the client asked for and what changed;
  - `HANDOFF.md`: written by Claude, with the sitemap, a component inventory, technical notes and stack suggestions;
  - `CLAUDE.md`: so the real project can start in Claude Code with full context.

## 10. Repository layout

```
prototyper/                    pnpm monorepo, TypeScript, MIT
  apps/
    desktop/                   Electron (electron-vite + React)
    server/                    Fastify + SQLite, Dockerfile, docker-compose + Caddyfile
  packages/
    shared/                    types, zod schemas, data-pt contract, apply-edits, linter
    overlay/                   review.js (vanilla TS, Shadow DOM)
    prototype-kit/             CLAUDE.md template, prompts, starter HTML, brand-extraction script
  docs/
    DESIGN.md                  this document
    self-hosting.md
```

`apply-edits` and the linter live in `shared` because both the app and the server need them (the server, for example, uses them to compute an edit's "before" value).

## 11. Milestones

| # | Scope | Verifiable outcome |
|---|---|---|
| M0 | Monorepo scaffold, `data-pt` contract, linter, `apply-edits`, CLAUDE.md template | unit tests for lint and edit application |
| M1 | App: library, new demo, Claude runner, build, preview, git versions | generate a v1 from a brief and view it in the app |
| M2 | Server + overlay: publish, link, text edits, notes, "I'm done" | the client edits and comments from a phone |
| M3 | Loop: import, review, apply, v2, changelog and replies, images | full v1 → v2 round on the same link |
| M4 | Brand extraction + brand editor + references | a demo generated from a real site's brand |
| M5 | Static and handoff export | a zip ready for the dev team |
| M6 | Packaging (electron-builder, macOS), Docker image, README, self-hosting guide, release | installable from GitHub Releases |

## 12. Risks

- **Claude ignoring the contract**: mitigated by the auto-fixing linter and by a starter HTML with examples. To be measured on 5–10 real briefs during M1.
- **Concurrent edits** (several people from the client using the same link): last write wins per key, with full history and author kept. Good enough for small demos.
- **macOS signing**: without an Apple Developer certificate, users must allow the app manually. Signing and notarization can come later.
- **Secret link only**: anyone who receives a forwarded link can edit. This is accepted; revoking the link or setting it to read-only covers the critical cases.
