# Prototyper

A macOS app for building landing-page and small-site **demos with Claude Code**, sharing them with clients through a link where they can **edit texts, swap images and leave notes**, and iterating version after version until the design and content are approved.

> **Status: early development.** The full loop works: generate a demo, share it, the client edits and comments, import the feedback and generate the next version on the same link. Brand extraction from the client's website and reference screenshots work too; export is next. See [docs/DESIGN.md](docs/DESIGN.md) for the design and the roadmap.

## How it works

1. Create a demo from a brief, optionally with the client's brand extracted from their website and reference screenshots.
2. Prototyper drives your local, logged-in [Claude Code](https://claude.com/claude-code) to generate a static HTML + Tailwind site.
3. Publish it to your self-hosted share server and send the link to the client.
4. The client edits copy and images in place and pins notes on the page.
5. Import the feedback: direct edits are applied deterministically, notes go to Claude, and the next version is published on the same link.
6. When approved, export the static site and a handoff pack for the real project.

## Repository layout

| Path | What |
|---|---|
| `packages/shared` | The `data-pt` content contract, linter and edit application |
| `packages/prototype-kit` | `CLAUDE.md` template, prompts and starter files for demos |
| `apps/desktop` | Electron app: library, Claude runner, build, preview, versions |
| `apps/server` | Self-hosted share server: serves demos to clients, stores their feedback ([self-hosting](docs/self-hosting.md)) |
| `packages/overlay` | Review toolbar injected into shared demos: edit texts and images, pin notes, submit |

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm test
pnpm typecheck
```

### Running the desktop app

Requires [Claude Code](https://claude.com/claude-code) installed and logged in.

```sh
pnpm --filter @prototyper/desktop dev
```

To try it without touching your real library and settings:

```sh
PROTOTYPER_LIBRARY=/tmp/pt-lib PROTOTYPER_USER_DATA=/tmp/pt-data pnpm --filter @prototyper/desktop dev
```

`apps/desktop/scripts/e2e-generate.ts` runs a full generation with the real CLI and no UI.

## License

[MIT](LICENSE)
