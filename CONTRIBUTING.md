# Contributing

Thanks for helping! Issues and pull requests are welcome.

## Setup

```sh
pnpm install
pnpm test        # unit tests (vitest)
pnpm typecheck   # TypeScript across the workspace
pnpm build       # overlay, panel, server and the plugin's MCP bundle
```

Run the server locally over plain http (see [docs/self-hosting.md](docs/self-hosting.md#local-development)), then work on the panel with hot reload:

```sh
pnpm --filter @prototyper/panel dev   # http://localhost:5173, proxies /api to :3700
```

Try the plugin from a checkout, in any project folder:

```sh
claude --plugin-dir /path/to/prototyper/plugin
```

## Where things are

- **The content contract** (`packages/shared`) is the core: every editable element has a `data-pt` key, and client edits are spliced into the HTML by source position. Changes here need tests.
- **The server** (`apps/server`): `routes/review.ts` (client links), `routes/panel.ts` (panel API, sessions, admin), `routes/api.ts` (MCP API), `routes/oauth.ts` (MCP login), `domains.ts` (certificates). Tests in `apps/server/test`.
- **The MCP server** (`packages/mcp`) is bundled into `plugin/server/prototyper-mcp.mjs`. After changing it run `pnpm --filter @prototyper/mcp build` and commit the bundle (CI checks it is up to date).
- **What Claude is told** lives in `plugin/skills/prototyper/SKILL.md` and in the tool descriptions in `packages/mcp/src/index.ts`.
- **The client overlay** (`packages/overlay`) is vanilla TypeScript in a Shadow DOM, with Italian and English strings in `src/i18n.ts`.
- **Panel translations** are in `apps/panel/src/i18n.tsx`, keyed by the English text.

## Guidelines

- Keep it small and readable; prefer plain files and explicit code over frameworks.
- Code, comments and docs in English. The UI is translated.
- Add or update tests for behavior changes (`pnpm test` must pass).
- Security-sensitive code (sessions, 2FA, OAuth, tokens, file paths) gets tests for the failure cases too.
- One topic per pull request, with a short description of what and why.
